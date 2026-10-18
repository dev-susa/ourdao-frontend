'use client'

import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import React from 'react'
import toast from 'react-hot-toast'
import { useWallet } from '@/lib/wallet'
import { getTransactionUrl } from '@/lib/stellar'
import { daoWrite, InvokeError, TransactionPendingError, watchTransaction, type InvokeResult } from '@/lib/dao-client'
import { queryKeys } from '@/lib/query-keys'
import { announce } from '@/lib/announce'
import { reportError } from '@/lib/error-reporting'
import { useDAOStats } from './reads'

// Issue #393: while the DAO is paused the contract rejects every state-changing
// call except loan repayment. Blocking those writes here — before the Freighter
// prompt — means a member gets this plain message instead of signing and then
// hitting a raw `Paused` simulation error.
const PAUSED_WRITE_MESSAGE =
  'The DAO is paused — only loan repayments are allowed right now. Try again once it is unpaused.'

// Write-status toasts are visual only. Status is announced by <LiveAnnouncer>
// (src/lib/announce.ts): a toast is inserted with its content already in it,
// which screen readers do not reliably announce, and an in-place update by id
// would otherwise be announced a second time on top of ours. react-hot-toast
// applies its own aria defaults per toast, so this must be passed per call.
const SILENT_TOAST = { ariaProps: { role: 'status', 'aria-live': 'off' } } as const

type OptimisticUpdate = {
  queryKey: QueryKey
  update: (current: unknown) => unknown
}

/**
 * Shared plumbing for a write action: resolves the wallet + signer, tracks
 * pending/success/error, surfaces toasts, and invalidates the query keys the
 * action affects once the write is confirmed.
 */
export function useWriteAction() {
  const { address, signXDR, isConnected, networkMismatch } = useWallet()
  const { isPaused } = useDAOStats()
  const queryClient = useQueryClient()
  const [isPending, setPending] = useState(false)
  const [isSuccess, setSuccess] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [isRetryable, setRetryable] = useState(false)

  const abortControllerRef = useRef<AbortController | null>(null)
  const toastIdRef = useRef<string | null>(null)

  const cancelSignature = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (toastIdRef.current) {
      toast.dismiss(toastIdRef.current)
      toastIdRef.current = null
    }
    setPending(false)
    setError(new Error('Signature request cancelled'))
    setRetryable(true)
    toast.error('Signature request cancelled')
    announce('Signature request cancelled.', 'assertive')
  }, [])

  const run = useCallback(
    async (
      label: string,
      fn: (w: ReturnType<typeof daoWrite>) => Promise<InvokeResult>,
      invalidates: QueryKey[] = [],
      optimisticUpdates: OptimisticUpdate[] = [],
      options: { allowWhenPaused?: boolean } = {}
    ) => {
      if (!isConnected || !address) {
        toast.error('Connect your wallet first')
        announce('Connect your wallet first.', 'assertive')
        throw new Error('Wallet not connected')
      }
      // Issue #393: the contract blocks every write except loan repayment while
      // paused. Stop non-repayment writes here, before the signer prompt, so the
      // member sees a friendly message rather than a raw simulation failure.
      if (isPaused && !options.allowWhenPaused) {
        toast.error(PAUSED_WRITE_MESSAGE)
        announce(PAUSED_WRITE_MESSAGE, 'assertive')
        throw new Error(PAUSED_WRITE_MESSAGE)
      }
      // Issue #241: block writes while the wallet is on the wrong network,
      // before any optimistic update or signer call, so a mismatched member
      // never reaches the Freighter approval prompt.
      if (networkMismatch) {
        toast.error('Wallet network mismatch: switch Freighter to the expected network before submitting.')
        throw new Error('Wallet network mismatch: transactions are blocked until the wallet network matches.')
      }
      setPending(true)
      setSuccess(false)
      setError(null)
      setRetryable(false)

      const toastId = toast.loading(`${label}…`, SILENT_TOAST)
      // Progress is polite: it must not interrupt whatever is being read.
      announce(`${label} in progress.`)
      toastIdRef.current = toastId

      const controller = new AbortController()
      abortControllerRef.current = controller
      const optimisticSnapshots = optimisticUpdates.map(({ queryKey, update }) => ({
        queryKey,
        previous: queryClient.getQueryData(queryKey),
        update,
      }))

      await Promise.all(
        optimisticUpdates.map(({ queryKey }) => queryClient.cancelQueries({ queryKey }))
      )
      for (const { queryKey, update } of optimisticSnapshots) {
        queryClient.setQueryData(queryKey, update)
      }

      const wrappedSignXDR = (xdr: string) =>
        signXDR(xdr, { signal: controller.signal })

      try {
        const res = await fn(daoWrite(address, wrappedSignXDR))
        setSuccess(true)
        announce(`${label} confirmed.`)
        toast.success(
          React.createElement(
            'span',
            null,
            `${label} confirmed `,
            React.createElement(
              'a',
              {
                href: getTransactionUrl(res.hash),
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'underline',
              },
              'View transaction'
            )
          ),
          { id: toastId, ...SILENT_TOAST }
        )
        // Awaited, deliberately (#308). A fire-and-forget `invalidateQueries`
        // only *marks* the data stale and kicks off a background refetch; the
        // promise it returns resolves once active queries have refetched. Not
        // awaiting it means `run()` resolves while the cache still holds the
        // pre-write value, so whatever the caller does next reads the old
        // world. Concretely: `registerMember()` would resolve, the page would
        // navigate to /dashboard, and the dashboard's membership guard would
        // read a cached `isMember: false` (stale data + `isLoading: false`,
        // because a background refetch isn't a *load*) and bounce the member
        // straight back to /register. Refetching the app runs with `retry: 0`,
        // so awaiting a failed read settles immediately rather than stalling
        // the write behind retry backoff.
        if (invalidates.length > 0) {
          await Promise.all(
            invalidates.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
          )
        }
        return res
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))

        // #309: a submission window that closed without a confirmation is not
        // a failure. Show the member the hash and an explorer link, explicitly
        // tell them not to resubmit, and keep checking in the background — if it
        // does land, the UI is upgraded to confirmed and the affected queries
        // are refetched, so a late confirmation reads as a success instead of
        // leaving a permanent red toast on a change that actually happened.
        if (e instanceof TransactionPendingError) {
          setError(e)
          setRetryable(false)
          const pendingMessage = `${label} was submitted but is not confirmed yet. It may still complete — please do not resubmit.`
          toast(
            React.createElement(
              'span',
              null,
              `${pendingMessage} `,
              e.url
                ? React.createElement(
                    'a',
                    {
                      href: e.url,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      className: 'underline',
                    },
                    'View transaction'
                  )
                : React.createElement('code', null, e.hash)
            ),
            { id: toastId, icon: '⏳', ...SILENT_TOAST }
          )
          announce(`${label} submitted and still confirming. Do not resubmit.`, 'polite')

          void watchTransaction(e.hash, {
            onConfirmed: async () => {
              // The change landed after the member was told to wait. Invalidate
              // the same keys the confirmed path would have, so the UI reflects
              // the on-chain state.
              if (invalidates.length > 0) {
                await Promise.all(
                  invalidates.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
                )
              }
              toast.success(`${label} confirmed.`, { id: toastId, ...SILENT_TOAST })
              announce(`${label} confirmed.`, 'polite')
            },
            onFailed: () => {
              const message = `${label} failed on-chain after being submitted.`
              reportError(new Error(message), { action: label, hash: e.hash, stage: 'on-chain-watch' })
              toast.error(message, { id: toastId, ...SILENT_TOAST })
              announce(message, 'assertive')
            },
          })
          // The optimistic snapshots must not be rolled back: the transaction
          // is in flight, and if it confirms the optimistic state was right.
          // If it fails on-chain, the invalidations above are moot but the
          // member is told plainly by the onFailed toast.
          throw e
        }

        for (const { queryKey, previous } of optimisticSnapshots) {
          queryClient.setQueryData(queryKey, previous)
        }
        const isTimeout = e.message.includes('timed out')
        const isCancel = e.message.includes('cancelled')
        const isInvokeRetryable = e instanceof InvokeError && e.retryable

        const retryable = isTimeout || isCancel || isInvokeRetryable
        reportError(e, { action: label, retryable })
        setError(e)
        setRetryable(retryable)

        // A failure interrupts (assertive); the same text is shown in the toast.
        let failure: string
        if (isTimeout) {
          failure = `${label} timed out. Signature request took too long. You can try again.`
        } else if (isCancel) {
          failure = `${label} signature cancelled.`
        } else if (retryable) {
          failure = `${label} failed: ${e.message} You can try again.`
        } else {
          failure = `${label} failed: ${e.message}`
        }
        toast.error(failure, { id: toastId, ...SILENT_TOAST })
        announce(failure, 'assertive')

        throw e
      } finally {
        setPending(false)
        abortControllerRef.current = null
        toastIdRef.current = null
      }
    },
    [address, isConnected, networkMismatch, isPaused, signXDR, queryClient]
  )

  return { run, isPending, isSuccess, error, isRetryable, address, cancelSignature, networkMismatch, isPaused }
}

export function useMemberRegistration() {
  const { run, isPending, isSuccess, error, address, cancelSignature } = useWriteAction()
  const registerMember = () =>
    run('Registering membership', (w) => w.registerMember(), [
      queryKeys.userData(address!),
      queryKeys.daoStats(),
    ])
  return { registerMember, isPending, error, isSuccess, cancelSignature }
}

export function useLoanRequest() {
  const { run, isPending, isSuccess, error, address, cancelSignature } = useWriteAction()
  const requestLoan = (amount: bigint) =>
    run('Requesting loan', (w) => w.requestLoan(amount), [
      queryKeys.backendStats(),
      queryKeys.userLoans(address!),
      queryKeys.userData(address!),
      queryKeys.loanProposalsAll(),
    ]).then(
      (res) => Number(res.returnValue)
    )
  return { requestLoan, isPending, error, isSuccess, cancelSignature }
}

export function useVoting() {
  const { run, isPending, isSuccess, error, address, cancelSignature } = useWriteAction()
  const voteOnProposal = (proposalId: number, support: boolean) =>
    run('Casting vote', (w) => w.voteOnLoanProposal(proposalId, support), [
      queryKeys.loanProposal(proposalId),
      queryKeys.loanProposalsAll(),
      queryKeys.hasVoted('Loan', proposalId, address!),
      // A vote is recorded against the member, so `userData` moves, and a
      // reaching quorum can immediately disburse, so both aggregates move.
      queryKeys.userData(address!),
      queryKeys.daoStats(),
      queryKeys.backendStats(),
    ], [
      {
        queryKey: queryKeys.hasVoted('Loan', proposalId, address!),
        update: () => support,
      },
    ])
  return { voteOnProposal, isPending, error, isSuccess, cancelSignature }
}

export function useLoanRepayment() {
  const { run, isPending, isSuccess, error, address, cancelSignature } = useWriteAction()
  // Repayment stays available while the DAO is paused — the contract allows it,
  // so each run() opts past the paused guard (#393).
  const REPAY_WHEN_PAUSED = { allowWhenPaused: true } as const
  // A repayment changes the loan on-chain, the member's derived share/yield in
  // `userData`, and the indexer-backed `userLoans` history that both the loans
  // page and the "you already have an active loan" guard read — so all three
  // plus both stat aggregates move. Omitting `userLoans` left a fully repaid
  // loan still listed as active for the member until the next poll (#308).
  const repayInvalidates = (loanId: number) => [
    queryKeys.loan(loanId),
    queryKeys.loanProposalsAll(),
    queryKeys.userData(address!),
    queryKeys.userLoans(address!),
    queryKeys.daoStats(),
    queryKeys.backendStats(),
  ]
  const repayLoan = (loanId: number, amount?: bigint) => {
    if (amount !== undefined) {
      if (amount <= BigInt(0)) throw new Error('Repayment amount must be greater than zero')
      return run('Repaying loan', (w) => w.repayLoanPartial(loanId, amount), repayInvalidates(loanId), [], REPAY_WHEN_PAUSED)
    }
    return run('Repaying loan', (w) => w.repayLoan(loanId), repayInvalidates(loanId), [], REPAY_WHEN_PAUSED)
  }
  const repayLoanPartial = (loanId: number, amount: bigint) => {
    if (amount <= BigInt(0)) throw new Error('Repayment amount must be greater than zero')
    // These used to be hand-written array literals instead of the queryKeys
    // factory. They happened to match what the factory returns, so nothing
    // visibly broke — but a future edit to the factory would have silently
    // desynced this hook from the reads that use it, and repayment would stop
    // refreshing the loan. The factory is the single source of truth (#308).
    return run('Repaying loan', (w) => w.repayLoanPartial(loanId, amount), repayInvalidates(loanId), [], REPAY_WHEN_PAUSED)
  }
  return { repayLoan, repayLoanPartial, isPending, error, isSuccess, cancelSignature }
}

export function useMarkLoanDefaulted() {
  const { run, isPending, isSuccess, error, address, cancelSignature } = useWriteAction()
  // Defaulting closes the loan, so it leaves the borrower's active list and
  // moves the pool's aggregate counts — not just the loan's own row.
  const markLoanDefaulted = (loanId: number) =>
    run('Marking loan defaulted', (w) => w.markLoanDefaulted(loanId), [
      queryKeys.loan(loanId),
      queryKeys.loanProposalsAll(),
      queryKeys.userData(address!),
      queryKeys.userLoans(address!),
      queryKeys.daoStats(),
      queryKeys.backendStats(),
    ])
  return { markLoanDefaulted, isPending, error, isSuccess, cancelSignature }
}

export function useRewards() {
  const { run, isPending, isSuccess, error, address, cancelSignature } = useWriteAction()
  // Claiming zeroes the member's pending yield *and* rolls it into the DAO's
  // lifetime totals, so both the on-chain and the indexed aggregate move.
  const claimInvalidates = [
    queryKeys.userData(address!),
    queryKeys.daoStats(),
    queryKeys.backendStats(),
  ]
  // Yield is the only claimable amount; claim_rewards pays it out.
  const claimRewards = () => run('Claiming yield', (w) => w.claimRewards(), claimInvalidates)
  return { claimRewards, isPending, error, isSuccess, cancelSignature }
}

export function useStaking() {
  const { run, isPending, isSuccess, error, address, cancelSignature } = useWriteAction()
  // Staking changes voting weight, which `useUserData` carries. Invalidating
  // only `stake` left the dashboard and every `canVote` calculation showing
  // the pre-stake weight until the next poll (#308).
  const stakeInvalidates = [
    queryKeys.stake(address!),
    queryKeys.userData(address!),
    queryKeys.daoStats(),
    queryKeys.backendStats(),
  ]
  const stake = (amount: bigint) => run('Staking', (w) => w.stake(amount), stakeInvalidates)
  const unstake = (amount: bigint) => run('Unstaking', (w) => w.unstake(amount), stakeInvalidates)
  return { stake, unstake, isPending, error, isSuccess, cancelSignature }
}

export function useTreasuryVoting() {
  const { run, isPending, isSuccess, error, address, cancelSignature } = useWriteAction()
  const voteOnTreasury = (proposalId: number, support: boolean) =>
    run('Casting vote', (w) => w.voteOnTreasuryProposal(proposalId, support), [
      queryKeys.treasuryProposalsAll(),
      queryKeys.hasVoted('Treasury', proposalId, address!),
      queryKeys.userData(address!),
      queryKeys.daoStats(),
      // The treasury proposal list is fed by the indexer aggregate, so a vote
      // that moves a proposal toward execution has to invalidate it too (#308).
      queryKeys.backendStats(),
    ], [
      {
        queryKey: queryKeys.hasVoted('Treasury', proposalId, address!),
        update: () => support,
      },
    ])
  return { voteOnTreasury, isPending, isSuccess, error, cancelSignature }
}

export function useProposeTreasury() {
  const { run, isPending, isSuccess, error, cancelSignature } = useWriteAction()
  const propose = (
    amount: bigint,
    destination: string,
    reason: string,
    isPrivate: boolean
  ) =>
    run(
      'Proposing withdrawal',
      (w) => w.proposeTreasuryWithdrawal(amount, destination, reason, isPrivate),
      [
        // This used to invalidate only `backendStats`. A brand-new proposal
        // therefore did not appear in the treasury list until the next poll,
        // so submitting looked like nothing happened (#308).
        queryKeys.treasuryProposalsAll(),
        queryKeys.backendStats(),
        queryKeys.daoStats(),
      ]
    )
  return { propose, isPending, isSuccess, error, cancelSignature }
}

export function useAttachDocument() {
  const { run, isPending, isSuccess, error, address, cancelSignature } = useWriteAction()
  // Attaching a document changes the proposal, not just the document's own
  // cache entry: the proposal rows show whether supporting documents exist, so
  // the affected list and detail are invalidated too (#308).
  const attach = (kind: 'Loan' | 'Treasury', proposalId: number, cid: string) =>
    run(
      'Attaching document',
      (w) => w.attachDocument(kind, proposalId, new TextEncoder().encode(cid.trim())),
      [
        queryKeys.proposalDocument(kind, proposalId),
        kind === 'Loan' ? queryKeys.loanProposal(proposalId) : queryKeys.treasuryProposalsAll(),
        queryKeys.loanProposalsAll(),
        queryKeys.userData(address!),
      ]
    )
  return { attach, isPending, isSuccess, error, cancelSignature }
}

export function useExitDao() {
  const { run, isPending, isSuccess, error, address, cancelSignature } = useWriteAction()
  // Exiting removes the member from the DAO and withdraws their share, stake,
  // and pending yield in one transaction. This invalidates the member's data,
  // the DAO stats (member count, treasury), and the indexer-backed stats.
  const exitDao = () =>
    run('Exiting DAO', (w) => w.exitDao(), [
      queryKeys.userData(address!),
      queryKeys.daoStats(),
      queryKeys.backendStats(),
    ])
  return { exitDao, isPending, error, isSuccess, cancelSignature }
}

export function useAdminActions() {
  const { run, isPending, isSuccess, error, cancelSignature } = useWriteAction()
  const pause = () => run('Pausing the DAO', (w) => w.pause(), [queryKeys.daoStats()])
  const unpause = () => run('Unpausing the DAO', (w) => w.unpause(), [queryKeys.daoStats()])
  const addAdmin = (admin: string) => run('Adding admin', (w) => w.addAdmin(admin), [queryKeys.admins()])
  const removeAdmin = (admin: string) =>
    run('Removing admin', (w) => w.removeAdmin(admin), [queryKeys.admins()])
  const setThreshold = (thresholdBps: number) =>
    run('Updating consensus threshold', (w) => w.setConsensusThreshold(thresholdBps), [
      queryKeys.daoStats(),
    ])
  return { pause, unpause, addAdmin, removeAdmin, setThreshold, isPending, isSuccess, error, cancelSignature }
}

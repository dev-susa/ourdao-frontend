// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useMemberRegistration,
  useVoting,
  useTreasuryVoting,
  useStaking,
  useAttachDocument,
} from '@/hooks/useDAO'

const mockRegisterMember = vi.fn()
const mockVoteOnLoanProposal = vi.fn()
const mockVoteOnTreasuryProposal = vi.fn()
const mockStake = vi.fn()
const mockAttachDocument = vi.fn()

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: 'GALICE',
    isConnected: true,
    signXDR: vi.fn(),
  }),
}))

vi.mock('@/lib/dao-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dao-client')>()
  return {
    ...actual,
    daoWrite: () => ({
      registerMember: (...args: unknown[]) => mockRegisterMember(...args),
      voteOnLoanProposal: (...args: unknown[]) => mockVoteOnLoanProposal(...args),
      voteOnTreasuryProposal: (...args: unknown[]) => mockVoteOnTreasuryProposal(...args),
      stake: (...args: unknown[]) => mockStake(...args),
      attachDocument: (...args: unknown[]) => mockAttachDocument(...args),
    }),
  }
})

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => 'id') },
}))

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function Harness<T>({ useHook, onRender }: { useHook: () => T; onRender: (h: T) => void }) {
  const hook = useHook()
  onRender(hook)
  return null
}

function renderWithClient<T>(client: QueryClient, useHook: () => T, onRender: (h: T) => void) {
  render(
    <QueryClientProvider client={client}>
      <Harness useHook={useHook} onRender={onRender} />
    </QueryClientProvider>
  )
}

describe('write-hook query invalidation', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('a successful registerMember invalidates userData and daoStats, and nothing else', async () => {
    mockRegisterMember.mockResolvedValue({ hash: 'tx1', returnValue: null })
    const client = makeClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

    let latest: ReturnType<typeof useMemberRegistration> | undefined
    renderWithClient(client, useMemberRegistration, (h) => { latest = h })

    await act(async () => {
      await latest!.registerMember()
    })

    await waitFor(
      () => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['userData', 'GALICE'] }),
      { timeout: 2000 }
    )
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['daoStats'] })
    expect(invalidateSpy).toHaveBeenCalledTimes(2)
  })

  // #308 — the registration bounce. `registerMember()` resolving while the
  // cache still holds the pre-write membership is what let /dashboard's guard
  // read a stale `isMember: false` (stale data is not `isLoading: true`, so the
  // guard treats it as a verdict) and bounce the member back to /register.
  describe('invalidation is awaited, not fired and forgotten', () => {
    it('does not resolve the write until the invalidation refetch settles', async () => {
      mockRegisterMember.mockResolvedValue({ hash: 'tx1', returnValue: null })
      const client = makeClient()
      // Hold the refetch open so we can observe that `run()` is parked on it.
      let releaseRefetch: () => void = () => {}
      const refetchInFlight = new Promise<void>((resolve) => {
        releaseRefetch = resolve
      })
      const invalidateSpy = vi
        .spyOn(client, 'invalidateQueries')
        .mockImplementation(() => refetchInFlight)

      let latest: ReturnType<typeof useMemberRegistration> | undefined
      renderWithClient(client, useMemberRegistration, (h) => { latest = h })

      let settled = false
      let write!: Promise<unknown>
      await act(async () => {
        write = latest!.registerMember().then(() => {
          settled = true
        })
        // The on-chain write resolves promptly; the invalidation does not.
        await new Promise((r) => setTimeout(r, 30))
      })

      expect(invalidateSpy).toHaveBeenCalled()
      expect(settled).toBe(false)

      await act(async () => {
        releaseRefetch()
        await write
      })
      expect(settled).toBe(true)
    })

    it('awaits every invalidated key, not just the first', async () => {
      mockStake.mockResolvedValue({ hash: 'tx3', returnValue: null })
      const client = makeClient()
      const calls: unknown[][] = []
      const invalidateSpy = vi.spyOn(client, 'invalidateQueries').mockImplementation((args) => {
        calls.push((args as { queryKey: unknown[] }).queryKey as unknown[])
        return Promise.resolve()
      })

      let latest: ReturnType<typeof useStaking> | undefined
      renderWithClient(client, useStaking, (h) => { latest = h })

      await act(async () => {
        await latest!.stake(BigInt(100))
      })

      expect(invalidateSpy).toHaveBeenCalledTimes(calls.length)
      expect(calls.map((k) => k[0]).sort()).toEqual(['backendStats', 'daoStats', 'stake', 'userData'])
    })
  })

  it('a failed registerMember invalidates nothing', async () => {
    mockRegisterMember.mockRejectedValue(new Error('NotEligible'))
    const client = makeClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

    let latest: ReturnType<typeof useMemberRegistration> | undefined
    renderWithClient(client, useMemberRegistration, (h) => { latest = h })

    await expect(
      act(async () => {
        await latest!.registerMember()
      })
    ).rejects.toThrow('NotEligible')

    // Give the (skipped) invalidation window a chance to fire if it were
    // going to, then confirm it never did.
    await new Promise((r) => setTimeout(r, 600))
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('voting invalidates the specific proposal, the proposal list, and daoStats (a vote can trigger disbursement)', async () => {
    mockVoteOnLoanProposal.mockResolvedValue({ hash: 'tx2', returnValue: null })
    const client = makeClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

    let latest: ReturnType<typeof useVoting> | undefined
    renderWithClient(client, useVoting, (h) => { latest = h })

    await act(async () => {
      await latest!.voteOnProposal(7, true)
    })

    await waitFor(
      () => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['loanProposal', 7] }),
      { timeout: 2000 }
    )
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['loanProposals'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['daoStats'] })
  })

  it('applies a vote optimistically and rolls it back when the write fails', async () => {
    let rejectVote: (error: Error) => void = () => {}
    mockVoteOnLoanProposal.mockReturnValue(
      new Promise((_, reject) => {
        rejectVote = reject
      })
    )
    const client = makeClient()
    client.setQueryData(['hasVoted', 'Loan', 7, 'GALICE'], false)

    let latest: ReturnType<typeof useVoting> | undefined
    renderWithClient(client, useVoting, (h) => { latest = h })
    const vote = latest!.voteOnProposal(7, true)

    await waitFor(() => {
      expect(client.getQueryData(['hasVoted', 'Loan', 7, 'GALICE'])).toBe(true)
    })

    rejectVote(new Error('NotEligible'))
    await expect(vote).rejects.toThrow('NotEligible')
    expect(client.getQueryData(['hasVoted', 'Loan', 7, 'GALICE'])).toBe(false)
  })

  it('marks treasury votes optimistically for the connected member and rolls back on failure', async () => {
    let rejectVote: (error: Error) => void = () => {}
    mockVoteOnTreasuryProposal.mockReturnValue(
      new Promise((_, reject) => {
        rejectVote = reject
      })
    )
    const client = makeClient()
    client.setQueryData(['hasVoted', 'Treasury', 12, 'GALICE'], false)

    let latest: ReturnType<typeof useTreasuryVoting> | undefined
    renderWithClient(client, useTreasuryVoting, (h) => { latest = h })
    const vote = latest!.voteOnTreasury(12, true)

    await waitFor(() => expect(client.getQueryData(['hasVoted', 'Treasury', 12, 'GALICE'])).toBe(true))
    rejectVote(new Error('NotEligible'))
    await expect(vote).rejects.toThrow('NotEligible')
    expect(client.getQueryData(['hasVoted', 'Treasury', 12, 'GALICE'])).toBe(false)
  })

  it('staking invalidates the connected address\'s own stake, its voting weight, and daoStats', async () => {
    mockStake.mockResolvedValue({ hash: 'tx3', returnValue: null })
    const client = makeClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

    let latest: ReturnType<typeof useStaking> | undefined
    renderWithClient(client, useStaking, (h) => { latest = h })

    await act(async () => {
      await latest!.stake(BigInt(100))
    })

    await waitFor(
      () => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['stake', 'GALICE'] }),
      { timeout: 2000 }
    )
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['daoStats'] })
    // Staking moves voting weight, which lives in userData — invalidating only
    // `stake` left the dashboard and every canVote showing the old weight.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['userData', 'GALICE'] })
  })

  it('attaching a document invalidates that document plus the proposal it hangs off', async () => {
    mockAttachDocument.mockResolvedValue({ hash: 'tx4', returnValue: null })
    const client = makeClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

    let latest: ReturnType<typeof useAttachDocument> | undefined
    renderWithClient(client, useAttachDocument, (h) => { latest = h })

    await act(async () => {
      await latest!.attach('Loan', 3, 'QmHash')
    })

    await waitFor(
      () =>
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['document', 'Loan', 3] }),
      { timeout: 2000 }
    )
    // The proposal rows themselves show whether documents exist, so they have
    // to refresh too.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['loanProposal', 3] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['loanProposals'] })
  })
})

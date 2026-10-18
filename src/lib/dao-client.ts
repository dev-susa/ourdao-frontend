'use client'

/**
 * Soroban client for the OurDAO contract.
 *
 * `read` simulates a contract call and decodes the result (no wallet needed).
 * `invoke` prepares, signs (via Freighter), submits, and polls a state-changing
 * call. Typed wrappers below mirror the Rust contract's public interface.
 *
 * All RPC calls are bounded by explicit timeouts so a hung Soroban RPC cannot
 * leave a query pending indefinitely. Reads and writes have separate budgets
 * because a write legitimately takes longer.
 */
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
  scValToNative,
  rpc,
  xdr,
} from '@stellar/stellar-sdk'
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  getTransactionUrl,
  isContractConfigured,
  server,
} from './stellar'
import type { Client as ContractClient, MethodOptions } from '@stellar/stellar-sdk/contract'
import { formatContractError } from './contract-errors'
import {
  Client,
  type Loan,
  type LoanPolicy,
  type LoanProposal,
  type LoanTerms,
  type Member,
  type ProposalKind,
  type TreasuryProposal,
} from './generated/dao-bindings'

// Multiplier for inclusion fee to survive network congestion.
// The inclusion fee (stroops/byte) is what validators use to order transactions
// when the ledger is full. BASE_FEE (100 stroops) is the protocol floor, not a
// recommended value. This multiplier ensures submissions carry headroom above the
// floor, preventing silent drops when competing with higher-fee transactions.
// Note: This is distinct from Soroban's resource fee, which prepareTransaction
// computes separately and adds on top of this inclusion fee.
const INCLUSION_FEE_MULTIPLIER = 1.5
// TransactionBuilder takes the fee as a string of stroops, and BASE_FEE is
// itself a string, so it must be coerced before the multiplication.
const INCLUSION_FEE = String(Math.ceil(Number(BASE_FEE) * INCLUSION_FEE_MULTIPLIER))

// ---------------------------------------------------------------------------
// Timeout configuration
// ---------------------------------------------------------------------------

/** Timeout for read-only RPC calls (simulateTransaction). */
export const READ_TIMEOUT_MS = 10_000

/** Timeout for write RPC calls (getAccount, prepareTransaction, sendTransaction, getTransaction). */
export const WRITE_TIMEOUT_MS = 60_000

/** Creates a promise that rejects after the given timeout. */
export function timeout<T>(ms: number, label: string): Promise<T> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
}

/** Wraps a promise with a timeout, preserving the original error type when possible. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  try {
    return await Promise.race([promise, timeout<T>(ms, label)])
  } catch (e) {
    if (e instanceof Error && e.message.includes('timed out')) {
      const timeoutError = new Error(e.message)
      // Mark as retryable so the UI can offer a retry
      ;(timeoutError as Error & { retryable: boolean }).retryable = true
      throw timeoutError
    }
    throw e
  }
}

// ---------------------------------------------------------------------------
// Compile-checked contract calls
//
// Method names and argument shapes come from the generated bindings
// (`generated/dao-bindings.ts`, produced by `npm run gen:contract`), so a
// contract rename or signature change fails `tsc` instead of failing at
// runtime. Arguments are encoded to ScVals from the contract spec embedded in
// those bindings rather than hand-built.
// ---------------------------------------------------------------------------

// Everything on the bindings `Client` that the SDK base class doesn't define.
export type ContractMethod = Exclude<keyof Client, keyof ContractClient>

type MethodParam<M extends ContractMethod> = Client[M] extends (a: infer A, ...r: never[]) => unknown
  ? A
  : never

/** Named-argument object for `M`, or no arguments for parameterless methods. */
export type CallArgs<M extends ContractMethod> = [MethodParam<M>] extends [MethodOptions | undefined]
  ? []
  : [args: MethodParam<M>]

// The spec is identical for every contract id, and constructing the client
// makes no network request, so placeholders are fine.
const SPEC_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM'
let specClient: Client | undefined

/** Encodes named contract arguments to ScVals in the contract's parameter order. */
export function encodeArgs<M extends ContractMethod>(
  method: M,
  ...[args]: CallArgs<M>
): xdr.ScVal[] {
  specClient ??= new Client({
    contractId: SPEC_CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: 'https://localhost',
  })
  return specClient.spec.funcArgsToScVals(method, (args ?? {}) as Record<string, unknown>)
}

export type { LoanPolicy, ProposalKind }

/**
 * A contract struct as decoded by `scValToNative`: field names are the
 * contract's (compile-checked), values are native JS and enums are `[tag]`.
 */
export type Raw<T> = { [K in keyof T]?: unknown }

const kind = (k: 'Loan' | 'Treasury'): ProposalKind => ({ tag: k, values: undefined })
const bytes = (b: Uint8Array): Buffer => Buffer.from(b)

// ---------------------------------------------------------------------------
// Core read / invoke
// ---------------------------------------------------------------------------

/** Simulate a read-only call on an arbitrary contract and decode the return value.
 * Returns null when no contractId is provided or the call yields no value. */
export async function readContract<T = unknown>(
  contractId: string,
  method: string,
  ...args: xdr.ScVal[]
): Promise<T | null> {
  if (!contractId) return null

  const contract = new Contract(contractId)
  // Simulation needs a source account but never touches it on-chain; a throwaway
  // keypair is generated per read even though a fixed placeholder would do.
  const source = new Account(Keypair.random().publicKey(), '0')
  const tx = new TransactionBuilder(source, {
    fee: INCLUSION_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build()

  const sim = await withTimeout(server.simulateTransaction(tx), READ_TIMEOUT_MS, 'simulateTransaction')
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(formatContractError(sim.error))
  }
  const retval = sim.result?.retval
  return retval ? (scValToNative(retval) as T) : null
}

/** Simulate a read-only call and decode the return value. Returns null when no
 * contract is configured or the call yields no value. */
export async function read<M extends ContractMethod, T = unknown>(
  method: M,
  ...args: CallArgs<M>
): Promise<T | null> {
  if (!isContractConfigured()) return null
  return readContract<T>(CONTRACT_ID, method, ...encodeArgs(method, ...args))
}

export interface InvokeResult {
  hash: string
  returnValue: unknown
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const POLL_INTERVAL_MS = 1000
/** Fallback poll budget when a signed transaction carries no time bounds
 * (shouldn't happen — `.setTimeout(30)` always sets one — but a hardcoded
 * cap is cheap insurance against polling forever). */
const DEFAULT_POLL_BUDGET_MS = 30_000

/**
 * How long a background {@link watchTransaction} keeps checking after
 * `invoke`'s submission window closed. Generous on purpose: this is the window
 * in which a late confirmation is still worth telling the member about, and it
 * costs nothing but an occasional `getTransaction` every few seconds.
 */
const BACKGROUND_WATCH_BUDGET_MS = 5 * 60_000

/**
 * Bounded resubmission for `TRY_AGAIN_LATER` (#309).
 *
 * `TRY_AGAIN_LATER` means the node declined to queue the transaction at all —
 * typically because its mempool is full. Nothing was submitted, so there is
 * nothing to poll and nothing to lose by trying again. The right response is to
 * wait out the congestion and resubmit, not to hand the member an error and
 * make them click.
 *
 * The bound matters as much as the retry: an unbounded retry against a
 * permanently saturated network would spin forever while the member stares at a
 * loading spinner. Three attempts with linear backoff (1s, 2s, 3s) is enough to
 * ride out a normal burst and then gives up honestly.
 */
const RESUBMIT_MAX_ATTEMPTS = 3
const RESUBMIT_BASE_BACKOFF_MS = 1_000

/**
 * A submission/confirmation failure from {@link invoke}, distinct from a
 * decoded on-chain contract error.
 *
 * `retryable` is true when resubmitting the exact same signed transaction
 * (or a fresh one, for `TRY_AGAIN_LATER`) has a real chance of succeeding —
 * a transient RPC-node condition rather than something the transaction
 * itself is wrong about — so the UI can offer a "Try again" affordance
 * instead of just surfacing the message (#58).
 */
export class InvokeError extends Error {
  readonly retryable: boolean

  constructor(message: string, opts: { retryable?: boolean } = {}) {
    super(message)
    this.name = 'InvokeError'
    this.retryable = opts.retryable ?? false
  }
}

/**
 * The submission window closed while the transaction was still unconfirmed.
 *
 * This is deliberately **not** an {@link InvokeError}, and specifically not a
 * retryable one. The transaction was accepted by the network and may still
 * land — `retryable: true` here would invite the member to resubmit a change
 * that might already be applied, which for a vote or a withdrawal is a real
 * cost. So this type carries the two things a UI needs to do the right thing:
 *
 *   - `hash` / `url` — so the member can check the transaction themselves, or
 *     follow it to an explorer, instead of being told to guess.
 *   - `retryable === false` — so the "Try again" affordance is not offered.
 *
 * `useWriteAction` catches this, keeps a background poll running via
 * {@link watchTransaction}, and upgrades the UI to "confirmed" if the
 * transaction does land after the window closed. See #309.
 */
export class TransactionPendingError extends Error {
  /** The submitted transaction's hash. Stable across confirmations. */
  readonly hash: string
  /**
   * Explorer link for {@link hash}, for the member to verify independently.
   * Null when the hash is empty, which the network would not have produced —
   * the message then falls back to naming the hash alone.
   */
  readonly url: string | null
  /** Always false: resubmitting could double-apply the change. */
  readonly retryable = false

  constructor(hash: string, url: string | null) {
    super(
      `Transaction ${hash} was submitted but not confirmed before its submission ` +
        `window closed. It may still complete — do not resubmit. ` +
        (url ? `Check ${url} for its status.` : 'Check its status on a Stellar explorer.')
    )
    this.name = 'TransactionPendingError'
    this.hash = hash
    this.url = url
  }
}


/**
 * Keep checking a submitted transaction after {@link invoke} has given up
 * waiting for it, so a late confirmation can still be reported as a success
 * rather than a failure.
 *
 * `invoke`'s poll is bounded by the transaction's own `timeBounds`, which is a
 * submission window, not a confirmation guarantee — closing it does not mean
 * the transaction was rejected. This is the reconciliation pass for that gap.
 *
 * Resolves on confirmation, on a terminal on-chain failure, or when `timeoutMs`
 * elapses without either; it never rejects, because there is no useful thing
 * for a caller to do with a background poll's failure beyond stopping.
 */
export async function watchTransaction(
  hash: string,
  handlers: {
    onConfirmed?: (returnValue: unknown) => void
    onFailed?: (status: string) => void
    /** Give up on the background watch after this long. Default 5 minutes. */
    timeoutMs?: number
  } = {}
): Promise<'confirmed' | 'failed' | 'timeout'> {
  const { onConfirmed, onFailed, timeoutMs = BACKGROUND_WATCH_BUDGET_MS } = handlers
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    try {
      const result = await withTimeout(
        server.getTransaction(hash),
        WRITE_TIMEOUT_MS,
        'getTransaction'
      )
      if (result.status === 'SUCCESS') {
        const confirmed = result as { returnValue?: xdr.ScVal }
        onConfirmed?.(
          confirmed.returnValue ? scValToNative(confirmed.returnValue) : null
        )
        return 'confirmed'
      }
      if (result.status !== 'NOT_FOUND') {
        onFailed?.(String(result.status))
        return 'failed'
      }
    } catch {
      // A transient RPC failure during background reconciliation is not
      // itself a verdict on the transaction. Keep polling until the budget
      // runs out; the final `timeout` is the honest answer.
    }
  }
  return 'timeout'
}

/** Prepare, sign, submit, and confirm a state-changing call. */
export async function invoke(
  walletAddress: string,
  signXDR: (xdr: string) => Promise<string>,
  method: string,
  ...args: xdr.ScVal[]
): Promise<InvokeResult> {
  if (!isContractConfigured()) {
    throw new Error('No contract configured (set NEXT_PUBLIC_CONTRACT_ID).')
  }

  const contract = new Contract(CONTRACT_ID)

  // One submission attempt: a *fresh* account read, build, simulate, sign, and
  // send. Rebuilt from scratch on every attempt because a resubmission has to
  // carry a new sequence number and a refreshed simulation — replaying a stale
  // signed transaction would come back as a bad-sequence error instead of the
  // congestion signal we are responding to (#309).
  // Assigned by submitOnce before the poll below reads it.
  let signed!: Transaction | FeeBumpTransaction

  const submitOnce = async () => {
    const account = await withTimeout(
      server.getAccount(walletAddress),
      WRITE_TIMEOUT_MS,
      'getAccount'
    )
    const built = new TransactionBuilder(account, {
      fee: INCLUSION_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build()

    // Simulate + assemble auth entries and resource footprint.
    const prepared = await withTimeout(
      server.prepareTransaction(built),
      WRITE_TIMEOUT_MS,
      'prepareTransaction'
    )
    const signedXdr = await signXDR(prepared.toXDR())
    signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE)

    return withTimeout(server.sendTransaction(signed), WRITE_TIMEOUT_MS, 'sendTransaction')
  }

  // Resubmit across a congested network, bounded (#309). `TRY_AGAIN_LATER` means
  // the node never queued anything, so there is nothing to poll and nothing to
  // double-apply — waiting out the congestion and resending is strictly better
  // than handing the member an error to click. The bound matters as much as the
  // retry: each attempt costs a signature prompt, and an unbounded loop against
  // a permanently saturated network would just spin behind a spinner.
  let sent!: Awaited<ReturnType<typeof server.sendTransaction>>
  for (let attempt = 1; attempt <= RESUBMIT_MAX_ATTEMPTS; attempt++) {
    sent = await submitOnce()
    if (sent.status !== 'TRY_AGAIN_LATER') break
    if (attempt < RESUBMIT_MAX_ATTEMPTS) {
      // Linear backoff: congestion clears on a human timescale, and the member
      // is not being asked to click anything.
      await sleep(RESUBMIT_BASE_BACKOFF_MS * attempt)
    }
  }
  const sentHash = sent.hash

  // Every `sendTransaction` status gets an explicit branch (#58) — the old
  // code only checked for 'ERROR' and let PENDING, DUPLICATE, and
  // TRY_AGAIN_LATER all fall through identically into the confirmation
  // poll below, even though TRY_AGAIN_LATER means the node never queued
  // the transaction at all: there is nothing to poll for, and polling
  // anyway just spends 30s finding out NOT_FOUND before reporting the
  // wrong cause.
  switch (sent.status) {
    case 'ERROR':
      throw new InvokeError(formatContractError(JSON.stringify(sent.errorResult)), {
        retryable: false,
      })
    case 'TRY_AGAIN_LATER':
      // The resubmission budget is spent, so the network really is saturated.
      // Nothing was queued, which makes this safe to retry — and the only
      // honest thing left is to tell the member.
      throw new InvokeError(
        `The network is busy and did not accept this transaction after ${RESUBMIT_MAX_ATTEMPTS} attempts. Please try again in a moment.`,
        { retryable: true }
      )
    case 'DUPLICATE':
      // Already queued by an earlier identical submission (e.g. a double
      // click) — poll for the hash that's already in flight rather than
      // treating this as a fresh failure or silently rebuilding/resending.
      break
    case 'PENDING':
      break
    default:
      // Exhaustiveness guard: a status the SDK's type union doesn't (yet)
      // name is safer surfaced as an explicit error than silently falling
      // into the poll below.
      throw new InvokeError(`Unexpected submission status: ${String(sent.status)}`, {
        retryable: false,
      })
  }

  // Poll until the transaction's own time bounds expire rather than a
  // hardcoded iteration count, so the poll budget always matches the
  // window during which the network could actually still include it.
  // FeeBumpTransaction has no timeBounds of its own (only its inner
  // Transaction does), so fall back to the default budget for those.
  const deadlineMs =
    signed instanceof Transaction && signed.timeBounds?.maxTime
      ? Number(signed.timeBounds.maxTime) * 1000
      : Date.now() + DEFAULT_POLL_BUDGET_MS

  let result = await withTimeout(
    server.getTransaction(sentHash),
    WRITE_TIMEOUT_MS,
    'getTransaction'
  )
  while (result.status === 'NOT_FOUND' && Date.now() < deadlineMs) {
    await sleep(POLL_INTERVAL_MS)
    result = await withTimeout(
      server.getTransaction(sentHash),
      WRITE_TIMEOUT_MS,
      'getTransaction'
    )
  }

  if (result.status === 'NOT_FOUND') {
    // Not a failure: the transaction was accepted and may still land, so this
    // throws the non-retryable pending error (hash + explorer link) and lets
    // `useWriteAction` reconcile in the background rather than telling the
    // member to resubmit something that might already be applied (#309).
    throw new TransactionPendingError(sentHash, getTransactionUrl(sentHash))
  }
  if (result.status !== 'SUCCESS') {
    throw new InvokeError(`Transaction ${sentHash} failed on-chain (${result.status}).`, {
      retryable: false,
    })
  }
  const confirmed = result as { returnValue?: xdr.ScVal }
  return {
    hash: sentHash,
    returnValue: confirmed.returnValue ? scValToNative(confirmed.returnValue) : null,
  }
}

// ---------------------------------------------------------------------------
// Typed read wrappers (mirror the Rust contract views)
// ---------------------------------------------------------------------------

export const daoRead = {
  getTotalMembers: (): Promise<number | null> => read('get_total_members'),
  getActiveMembers: (): Promise<number | null> => read('get_active_members'),
  getConsensusThreshold: (): Promise<number | null> => read('get_consensus_threshold'),
  getTreasuryBalance: (): Promise<bigint | null> => read('get_treasury_balance'),
  getLoanPolicy: (): Promise<Raw<LoanPolicy> | null> => read('get_loan_policy'),
  getToken: (): Promise<string | null> => read('get_token'),
  isPaused: (): Promise<boolean | null> => read('is_paused'),
  getAdmins: (): Promise<string[] | null> => read('get_admins'),
  isMember: (address: string): Promise<boolean | null> => read('is_member', { address }),
  isAdmin: (address: string): Promise<boolean | null> => read('is_admin', { address }),
  isEligibleForLoan: (member: string): Promise<boolean | null> =>
    read('is_eligible_for_loan', { member }),
  getMember: (address: string): Promise<Raw<Member> | null> => read('get_member', { address }),
  getPendingYield: (member: string): Promise<bigint | null> =>
    read('get_pending_yield', { member }),
  getStake: (member: string): Promise<bigint | null> => read('get_stake', { member }),
  getLoan: (id: number): Promise<Raw<Loan> | null> => read('get_loan', { loan_id: id }),
  getLoanProposal: (id: number): Promise<Raw<LoanProposal> | null> =>
    read('get_loan_proposal', { proposal_id: id }),
  getTreasuryProposal: (id: number): Promise<Raw<TreasuryProposal> | null> =>
    read('get_treasury_proposal', { proposal_id: id }),
  calculateLoanTerms: (amount: bigint | number): Promise<Raw<LoanTerms> | null> =>
    read('calculate_loan_terms', { amount: BigInt(amount) }),
  calculateExitShare: (member: string): Promise<bigint | null> =>
    read('calculate_exit_share', { member }),
  resolveName: (name: string): Promise<string | null> => read('resolve_name', { name }),
  nameOf: (owner: string): Promise<string | null> => read('name_of', { owner }),
  getDocument: (k: 'Loan' | 'Treasury', id: number): Promise<Uint8Array | null> =>
    read('get_document', { kind: kind(k), proposal_id: id }),
  // For a private (commit-reveal) treasury proposal this is true as soon as
  // `voter` has committed, not only once revealed — the contract folds both
  // into one bool since a commitment already blocks a second vote. There is
  // no separate view to tell "committed, not yet revealed" apart from
  // "fully voted".
  hasVoted: (k: 'Loan' | 'Treasury', proposalId: number, voter: string): Promise<boolean | null> =>
    read('has_voted', { kind: kind(k), proposal_id: proposalId, voter }),
}

/** Standard SEP-41 token contract reads. */
export const tokenRead = {
  getDecimals: (tokenId: string) => readContract<number>(tokenId, 'decimals'),
  getSymbol: (tokenId: string) => readContract<string>(tokenId, 'symbol'),
  getName: (tokenId: string) => readContract<string>(tokenId, 'name'),
  getBalance: (tokenId: string, userAddr: string) =>
    readContract<bigint>(tokenId, 'balance', new Address(userAddr).toScVal()),
}

// ---------------------------------------------------------------------------
// Typed write wrappers — bound to a connected wallet + signer
// ---------------------------------------------------------------------------

export function daoWrite(
  address: string,
  signXDR: (xdr: string) => Promise<string>
) {
  const send = <M extends ContractMethod>(method: M, ...args: CallArgs<M>) =>
    invoke(address, signXDR, method, ...encodeArgs(method, ...args))

  return {
    registerMember: () => send('register_member', { member: address }),
    exitDao: () => send('exit_dao', { member: address }),
    claimRewards: () => send('claim_rewards', { member: address }),

    // `metadataCid` is the optional off-chain metadata pointer the contract
    // stores with the proposal.
    requestLoan: (amount: bigint | number, metadataCid?: string) =>
      send('request_loan', {
        borrower: address,
        amount: BigInt(amount),
        metadata_cid: metadataCid,
      }),
    editLoanProposal: (proposalId: number, newAmount: bigint | number) =>
      send('edit_loan_proposal', {
        borrower: address,
        proposal_id: proposalId,
        new_amount: BigInt(newAmount),
      }),
    voteOnLoanProposal: (proposalId: number, support: boolean) =>
      send('vote_on_loan_proposal', { voter: address, proposal_id: proposalId, support }),
    repayLoan: (loanId: number) =>
      send('repay_loan', { borrower: address, loan_id: loanId }),
    // Partial repayment — amount is applied to accrued interest first, then
    // principal; the interest portion is distributed to active members as
    // yield immediately (see contracts/dao/src/loans.rs). Rejects amount
    // <= 0 or amount > outstanding balance.
    repayLoanPartial: (loanId: number, amount: bigint | number) =>
      send('repay_loan_partial', {
        borrower: address,
        loan_id: loanId,
        amount: BigInt(amount),
      }),
    // Permissionless: the contract takes no caller argument (anyone can
    // trigger this once a loan is overdue past its grace period).
    markLoanDefaulted: (loanId: number) =>
      send('mark_loan_defaulted', { loan_id: loanId }),

    proposeTreasuryWithdrawal: (
      amount: bigint | number,
      destination: string,
      reason: string,
      isPrivate: boolean
    ) =>
      send('propose_treasury_withdrawal', {
        proposer: address,
        amount: BigInt(amount),
        destination,
        reason,
        private: isPrivate,
      }),
    voteOnTreasuryProposal: (proposalId: number, support: boolean) =>
      send('vote_on_treasury_proposal', {
        voter: address,
        proposal_id: proposalId,
        support,
      }),

    stake: (amount: bigint | number) =>
      send('stake', { member: address, amount: BigInt(amount) }),
    unstake: (amount: bigint | number) =>
      send('unstake', { member: address, amount: BigInt(amount) }),

    registerName: (name: string) => send('register_name', { owner: address, name }),

    commitTreasuryVote: (proposalId: number, commitment: Uint8Array) =>
      send('commit_treasury_vote', {
        voter: address,
        proposal_id: proposalId,
        commitment: bytes(commitment),
      }),
    revealTreasuryVote: (proposalId: number, support: boolean, salt: Uint8Array) =>
      send('reveal_treasury_vote', {
        voter: address,
        proposal_id: proposalId,
        support,
        salt: bytes(salt),
      }),

    attachDocument: (k: 'Loan' | 'Treasury', proposalId: number, contentHash: Uint8Array) =>
      send('attach_document', {
        caller: address,
        kind: kind(k),
        proposal_id: proposalId,
        content_hash: bytes(contentHash),
      }),

    // Admin-only entrypoints. The contract itself enforces the admin check
    // (`util::require_admin`) — `address` here is the connected wallet acting
    // as `caller`, not necessarily an admin; a non-admin call simply fails
    // on-chain with NotAdmin.
    addAdmin: (admin: string) => send('add_admin', { caller: address, admin }),
    removeAdmin: (admin: string) => send('remove_admin', { caller: address, admin }),
    setConsensusThreshold: (threshold: number) =>
      send('set_consensus_threshold', { caller: address, threshold }),
    setLoanPolicy: (policy: LoanPolicy) =>
      send('set_loan_policy', { caller: address, policy }),
    pause: () => send('pause', { caller: address }),
    unpause: () => send('unpause', { caller: address }),
  }
}

export type DaoWrite = ReturnType<typeof daoWrite>

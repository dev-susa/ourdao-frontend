'use client'

/**
 * Client for the OurDAO backend (ourdao-backend) — the off-chain indexer +
 * read API. The Soroban contract stays the source of truth for writes and
 * live member/treasury reads; the backend supplies history and aggregates the
 * chain can't cheaply serve (loan history, notifications, the event feed).
 *
 * Reads degrade rather than crash the app, but they no longer disguise a
 * failure as "no data": when the backend is not configured (preview mode) a
 * read resolves to its empty fallback, but when it IS configured and the
 * request fails (unreachable, CORS, non-2xx) the read rejects with a
 * BackendError. TanStack Query surfaces that as `isError` on the hook, and the
 * consumer renders a "couldn't load" state — an unreachable indexer and an
 * empty loan list must not look the same to a member.
 *
 * Writes are a different story: they need a signed `StellarSignature` header
 * (see ./backend-auth.ts for the handshake), and they report a typed outcome
 * instead of a bare boolean so a rejected signature or a 401 rolls the caller's
 * optimistic state back rather than leaving the UI claiming a change the backend
 * never made (#306).
 */
import { AuthError, buildAuthHeader, requestSignedAuth, type AuthFailureReason, type AuthSigner, type SignedAuth } from './backend-auth'
import { BACKEND_URL, isBackendConfigured } from './backend-config'
import type { paths } from './generated/backend-api'

export { BACKEND_URL, isBackendConfigured }

/** A configured backend could not be read (network failure or non-2xx). */
export class BackendError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'BackendError'
    this.status = status
  }
}

// --- Response shapes (mirror ourdao-backend/src/types.ts as of commit 7620d26; amounts are strings) ---


export interface BackendReady {
  ready: boolean
  indexerStale?: boolean
  estimatedLagSeconds?: number
  lastIndexedLedger?: number | null
}

type StatsBody = paths['/api/stats']['get']['responses']['200']['content']['application/json']
type LoanItem = paths['/api/loans']['get']['responses']['200']['content']['application/json'][number]

/**
 * Stats fields the app reads that ourdao-backend's DAOStats type returns but the
 * committed openapi.json does not declare yet. Remove each one once the spec
 * includes it (#343).
 */
interface BackendStatsSpecGap {
  lastIndexedLedger: number | null
  secondsSinceUpdate: number | null
  indexerStale: boolean
}

/** Stats fields the app has always treated as optional; the spec declares them required. */
type OptionalStatsFields =
  | 'quarantinedEvents'
  | 'totalContribution'
  | 'stakingRatio'
  | 'connectedStreams'
  | 'notificationFailures'
  | 'reorgHalt'

/** Generated from /api/stats in src/lib/generated/backend-api.ts, plus the spec gap above. */
export type BackendStats = Required<Omit<StatsBody, OptionalStatsFields>> &
  BackendStatsSpecGap &
  Partial<Pick<StatsBody, OptionalStatsFields>>

/**
 * Generated from /api/loans in src/lib/generated/backend-api.ts. `due_time` is
 * overridden: the app reads it as a ledger timestamp number, but the spec types it
 * as a string, so the spec needs fixing before this override can go (#343).
 */
export type BackendLoan = Required<
  Omit<LoanItem, 'due_time' | 'interest_charge' | 'repaid_amount' | 'repayment_progress_bps'>
> &
  Pick<LoanItem, 'interest_charge' | 'repaid_amount' | 'repayment_progress_bps'> & {
    due_time: number | null
  }

export interface BackendNotification {
  id: number
  address: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message: string
  ledger: number | null
  tx_hash: string | null
  read: boolean
  created_at: string
}

export interface BackendInterestDistribution {
  id: number
  ledger: number
  amount: string
  active_members: number
  tx_hash: string | null
  created_at: string
}


export interface BackendFailedEvent {
  id: number | string
  ledger: number
  symbol: string
  error: string
  retry_count?: number
  created_at: string
  tx_hash?: string | null
}

export const isBackendFailedEvent = (value: unknown): value is BackendFailedEvent => {
  if (!isRecord(value)) return false
  return (
    (isNumber(value.id) || isString(value.id)) &&
    isNumber(value.ledger) &&
    isString(value.symbol) &&
    isString(value.error) &&
    isString(value.created_at)
  )
}

export interface BackendDocumentAttachment {
  id: number | string
  kind: string
  proposal_id: number
  cid: string
  attached_by: string
  ledger: number
  tx_hash: string | null
  created_at: string
}

export const isBackendDocumentAttachment = (value: unknown): value is BackendDocumentAttachment => {
  if (!isRecord(value)) return false
  return (
    (isNumber(value.id) || isString(value.id)) &&
    isString(value.kind) &&
    isNumber(value.proposal_id) &&
    isString(value.cid) &&
    isString(value.attached_by) &&
    isNumber(value.ledger) &&
    isString(value.created_at)
  )
}

export interface BackendTimelineEvent {
  symbol: string
  ledger: number
  tx_hash: string | null
  created_at: string
  description?: string
  /** Raw event topics, as on `BackendEvent`; for votes, topics[2] is the voter. */
  topics?: unknown
  data?: unknown
}

export const isBackendTimelineEvent = (value: unknown): value is BackendTimelineEvent => {
  if (!isRecord(value)) return false
  return isString(value.symbol) && isNumber(value.ledger) && isString(value.created_at)
}

export interface BackendMemberSummary {
  address: string
  is_active: boolean
  joined_at: string | null
  shares_bps: number
  staked_amount: string
  unread_notifications: number
  loans_count: number
  active_loans_count: number
}

export const isBackendMemberSummary = (value: unknown): value is BackendMemberSummary => {
  if (!isRecord(value)) return false
  return (
    isString(value.address) &&
    isBoolean(value.is_active) &&
    isNumber(value.shares_bps) &&
    isString(value.staked_amount) &&
    isNumber(value.unread_notifications) &&
    isNumber(value.loans_count) &&
    isNumber(value.active_loans_count)
  )
}

// A row from GET /api/members — the raw `members` table (ourdao-backend). The
// summary endpoint above is a per-member projection; this is the directory row,
// so it carries the join/exit ledgers and the staked/contributed amounts rather
// than the derived share and notification counts.
export interface BackendMember {
  address: string
  joined_ledger: number | null
  contribution: string
  exited: boolean
  exit_share: string | null
  exited_ledger: number | null
  pending_claimed: string
  stake: string
  has_active_loan: boolean
  name: string | null
  defaults_count: number
  updated_at: string
}

export const isBackendMember = (value: unknown): value is BackendMember => {
  if (!isRecord(value)) return false
  return (
    isString(value.address) &&
    isNullableNumber(value.joined_ledger) &&
    isString(value.contribution) &&
    isBoolean(value.exited) &&
    (value.exit_share === undefined || isNullableString(value.exit_share)) &&
    isNullableNumber(value.exited_ledger) &&
    isString(value.pending_claimed) &&
    isString(value.stake) &&
    isBoolean(value.has_active_loan) &&
    (value.name === undefined || isNullableString(value.name)) &&
    isNumber(value.defaults_count) &&
    isString(value.updated_at)
  )
}

export interface BackendEvent {
  id: string
  ledger: number
  closed_at: string
  contract_id: string
  symbol: string
  topics: unknown
  data: unknown
  tx_hash: string | null
  created_at: string
}

type Validator<T> = (value: unknown) => value is T

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number'
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isNumber(value)
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value)

export const isBackendStats = (value: unknown): value is BackendStats => {
  if (!isRecord(value)) return false
  return (
    isNumber(value.totalMembers) &&
    isNumber(value.activeMembers) &&
    isNumber(value.totalLoanProposals) &&
    isNumber(value.totalLoans) &&
    isNumber(value.activeLoans) &&
    isNumber(value.defaultedLoans) &&
    isNumber(value.totalTreasuryProposals) &&
    isString(value.totalStaked) &&
    isNullableNumber(value.lastIndexedLedger) &&
    isNullableNumber(value.secondsSinceUpdate) &&
    isBoolean(value.indexerStale) &&
    isString(value.totalDefaultedValue) &&
    isString(value.interestCollected) &&
    isString(value.principalLent) &&
    isString(value.principalRepaid) &&
    isString(value.valueDefaulted) &&
    (value.quarantinedEvents === undefined || isNumber(value.quarantinedEvents))
  )
}

export const isBackendLoan = (value: unknown): value is BackendLoan => {
  if (!isRecord(value)) return false
  return (
    isNumber(value.id) &&
    isString(value.borrower) &&
    isString(value.amount) &&
    isString(value.outstanding) &&
    isString(value.total_repayment) &&
    isNullableNumber(value.due_time) &&
    (value.status === 'active' || value.status === 'repaid' || value.status === 'defaulted') &&
    isNullableNumber(value.approved_ledger) &&
    isNullableNumber(value.repaid_ledger) &&
    isNullableNumber(value.defaulted_ledger) &&
    isString(value.updated_at) &&
    (value.interest_charge === undefined || isNullableString(value.interest_charge)) &&
    (value.repaid_amount === undefined || isNullableString(value.repaid_amount))
  )
}

export const isBackendNotification = (value: unknown): value is BackendNotification => {
  if (!isRecord(value)) return false
  return (
    isNumber(value.id) &&
    isString(value.address) &&
    ['success', 'error', 'warning', 'info'].includes(String(value.type)) &&
    isString(value.title) &&
    isString(value.message) &&
    isNullableNumber(value.ledger) &&
    isNullableString(value.tx_hash) &&
    isBoolean(value.read) &&
    isString(value.created_at)
  )
}

export const isBackendEvent = (value: unknown): value is BackendEvent => {
  if (!isRecord(value)) return false
  return (
    isString(value.id) &&
    isNumber(value.ledger) &&
    isString(value.closed_at) &&
    isString(value.contract_id) &&
    isString(value.symbol) &&
    isNullableString(value.tx_hash) &&
    isString(value.created_at)
  )
}

export const isBackendInterestDistribution = (
  value: unknown
): value is BackendInterestDistribution => {
  if (!isRecord(value)) return false
  return (
    isNumber(value.id) &&
    isNumber(value.ledger) &&
    isString(value.amount) &&
    isNumber(value.active_members) &&
    isNullableString(value.tx_hash) &&
    isString(value.created_at)
  )
}

const arrayOf =
  <T>(itemValidator: Validator<T>): Validator<T[]> =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(itemValidator)

// --- Fetch helper -----------------------------------------------------------

export const DEFAULT_BACKEND_TIMEOUT_MS = 10_000

export interface BackendRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

function combineSignals(
  timeoutMs: number,
  userSignal?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`))
  }, timeoutMs)

  const onAbort = () => {
    controller.abort(userSignal?.reason ?? new Error('Request was aborted'))
  }

  if (userSignal) {
    if (userSignal.aborted) {
      clearTimeout(timer)
      controller.abort(userSignal.reason ?? new Error('Request was aborted'))
    } else {
      userSignal.addEventListener('abort', onAbort, { once: true })
    }
  }

  const cleanup = () => {
    clearTimeout(timer)
    if (userSignal) {
      userSignal.removeEventListener('abort', onAbort)
    }
  }

  return { signal: controller.signal, cleanup }
}

async function get<T>(
  path: string,
  fallback: T,
  validate?: Validator<T>,
  options?: BackendRequestOptions | AbortSignal
): Promise<T> {
  // Preview mode: nothing to read from, so the empty fallback is the truth.
  if (!isBackendConfigured()) return fallback
  const base = process.env.NEXT_PUBLIC_BACKEND_URL || ''

  const userSignal = options instanceof AbortSignal ? options : options?.signal
  const timeoutMs =
    options && !(options instanceof AbortSignal) && options.timeoutMs !== undefined
      ? options.timeoutMs
      : DEFAULT_BACKEND_TIMEOUT_MS

  const { signal, cleanup } = combineSignals(timeoutMs, userSignal)

  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      headers: { accept: 'application/json' },
      // Indexed data changes often; never serve a stale cache.
      cache: 'no-store',
      signal,
    })
  } catch (cause) {
    if (signal.aborted) {
      const msg =
        signal.reason instanceof Error
          ? signal.reason.message
          : String(signal.reason ?? 'Request aborted or timed out')
      throw new BackendError(msg)
    }
    // Backend down / CORS / network.
    throw new BackendError(
      `Backend unreachable: ${cause instanceof Error ? cause.message : String(cause)}`
    )
  } finally {
    cleanup()
  }
  if (!res.ok) throw new BackendError(`Backend responded ${res.status}`, res.status)
  let body: unknown
  try {
    body = await res.json()
  } catch (cause) {
    // A proxy error page or an HTML 200 is not JSON; surfacing it as a
    // BackendError keeps "the indexer changed shape" and "the indexer is
    // broken" on the same code path instead of a raw SyntaxError (#363).
    throw new BackendError(
      `Backend response for ${path} was not valid JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    )
  }
  // Every call site passes a validator; it was previously accepted as a third
  // argument and then dropped on the floor, so a drifted response shape was
  // cast straight into the caller's type (#306). Rejecting it here means the
  // consumer's `isError` state can stand in for "the indexer changed shape"
  // instead of rendering half-parsed rows.
  if (validate && !validate(body)) {
    throw new BackendError(`Backend response for ${path} did not match the expected shape`)
  }
  return body as T
}

// --- Authenticated mutation helper -------------------------------------------

/** Why a write did not land. Distinguishes "you can fix this" from "you can't". */
export type MutationFailureReason =
  /** The signed header was missing, invalid, or its nonce was spent/expired. */
  | 'unauthorized'
  /** Authenticated, but not permitted to touch this resource (another address's). */
  | 'forbidden'
  /** This address can never authenticate against the backend (a `C…` account). */
  | 'unsupported-address'
  /** The member declined the signature prompt, or no prompt was possible. */
  | 'rejected'
  /** Backend unreachable, rate-limited, or otherwise not answering. */
  | 'unavailable'

/**
 * The outcome of a backend write. `ok: false` always carries a
 * member-facing `message` — a mutation must never fail silently, because the
 * caller's optimistic state has to be rolled back and the member told why.
 */
export type MutationResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; reason: MutationFailureReason; message: string }

/** The failure arm of {@link MutationResult}, named so callers can accept just
 *  the case they handle. */
export type MutationFailure = Extract<MutationResult, { ok: false }>

/** Fold a handshake failure into the mutation vocabulary. A challenge that
 *  could not be issued or came back unusable is the backend being unable to
 *  serve us, not the member having done anything wrong. */
function reasonFromAuth(reason: AuthFailureReason): MutationFailureReason {
  switch (reason) {
    case 'unsupported-address':
      return 'unsupported-address'
    case 'rejected':
      return 'rejected'
    case 'challenge-rejected':
    case 'challenge-unavailable':
      return 'unavailable'
  }
}

/** Map a non-2xx response onto a typed reason, using the backend's own error
 *  string when it sends one (its error envelope is always `{ error, ... }`). */
async function classifyFailure(res: Response): Promise<MutationResult> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  const detail = typeof body?.error === 'string' && body.error ? body.error : null
  const reason: MutationFailureReason =
    res.status === 401
      ? 'unauthorized'
      : res.status === 403
        ? 'forbidden'
        : res.status === 400
          ? 'unsupported-address'
          : 'unavailable'
  return {
    ok: false,
    status: res.status,
    reason,
    message:
      detail ??
      (reason === 'unauthorized'
        ? 'The backend rejected this signature. It may have expired — please try again.'
        : `The backend responded ${res.status}`),
  }
}

/**
 * PATCH with no body, authenticated by a freshly signed challenge.
 *
 * Returns a typed {@link MutationResult} rather than a boolean: the previous
 * `res.ok`-only version could not distinguish "the member rejected the
 * signature" from "the backend 401'd" from "the backend was down", so every
 * caller had to assume success and leave its optimistic state in place (#306).
 */
async function patch(
  path: string,
  signer: AuthSigner,
  options?: BackendRequestOptions | AbortSignal
): Promise<MutationResult> {
  if (!isBackendConfigured()) {
    return {
      ok: false,
      status: null,
      reason: 'unavailable',
      message: 'No backend is configured, so this change cannot be saved.',
    }
  }

  const userSignal = options instanceof AbortSignal ? options : options?.signal
  const timeoutMs =
    options && !(options instanceof AbortSignal) && options.timeoutMs !== undefined
      ? options.timeoutMs
      : DEFAULT_BACKEND_TIMEOUT_MS

  const { signal, cleanup } = combineSignals(timeoutMs, userSignal)

  let auth: SignedAuth
  try {
    auth = await requestSignedAuth(signer)
  } catch (err) {
    cleanup()
    if (err instanceof AuthError) {
      return { ok: false, status: err.status, reason: reasonFromAuth(err.reason), message: err.message }
    }
    return {
      ok: false,
      status: null,
      reason: 'rejected',
      message: err instanceof Error ? err.message : 'Could not obtain a signature.',
    }
  }

  const base = process.env.NEXT_PUBLIC_BACKEND_URL || ''
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: 'PATCH',
      headers: {
        // Must match the backend's `extractAuthHeaders` exactly: the scheme
        // prefix, then three colon-separated fields.
        Authorization: buildAuthHeader(auth),
      },
      cache: 'no-store',
      signal,
    })
  } catch (cause) {
    if (signal.aborted) {
      const msg =
        signal.reason instanceof Error
          ? signal.reason.message
          : String(signal.reason ?? 'Request aborted or timed out')
      return {
        ok: false,
        status: null,
        reason: 'unavailable',
        message: msg,
      }
    }
    return {
      ok: false,
      status: null,
      reason: 'unavailable',
      message: `Could not reach the backend: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    }
  } finally {
    cleanup()
  }
  if (!res.ok) return classifyFailure(res)
  return { ok: true, status: res.status }
}

// --- Endpoints --------------------------------------------------------------

export const backend = {
  isConfigured: isBackendConfigured,
  getReady: (options?: BackendRequestOptions | AbortSignal) =>
    get<BackendReady | null>(
      '/ready',
      null,
      (value): value is BackendReady | null =>
        value === null || (isRecord(value) && isBoolean(value.ready)),
      options
    ),
  getStats: (options?: BackendRequestOptions | AbortSignal) =>
    get<BackendStats | null>(
      '/api/stats',
      null,
      (value): value is BackendStats | null =>
        value === null || isBackendStats(value),
      options
    ),

  getLoans: (borrower?: string, options?: BackendRequestOptions | AbortSignal) =>
    get<BackendLoan[]>(
      borrower ? `/api/loans?borrower=${encodeURIComponent(borrower)}` : '/api/loans',
      [],
      arrayOf(isBackendLoan),
      options
    ),

  getLoan: (id: number, options?: BackendRequestOptions | AbortSignal) =>
    get<BackendLoan | null>(
      `/api/loans/${id}`,
      null,
      (value): value is BackendLoan | null =>
        value === null || isBackendLoan(value),
      options
    ),

  getNotifications: (address: string, limit = 50, options?: BackendRequestOptions | AbortSignal) =>
    get<BackendNotification[]>(
      `/api/notifications?address=${encodeURIComponent(address)}&limit=${limit}`,
      [],
      arrayOf(isBackendNotification),
      options
    ),

  getEvents: (limit = 50, symbol?: string, options?: BackendRequestOptions | AbortSignal) =>
    get<BackendEvent[]>(
      symbol
        ? `/api/events?symbol=${encodeURIComponent(symbol)}&limit=${limit}`
        : `/api/events?limit=${limit}`,
      [],
      arrayOf(isBackendEvent),
      options
    ),

  getAdminLog: (limit = 50, options?: BackendRequestOptions | AbortSignal) =>
    get<BackendEvent[]>(`/api/admin/log?limit=${limit}`, [], arrayOf(isBackendEvent), options),

  getInterestDistributions: (
    opts?: { before?: number; limit?: number },
    options?: BackendRequestOptions | AbortSignal
  ) => {
    const params = new URLSearchParams()
    if (opts?.before !== undefined && opts?.before !== null) {
      params.set('before', String(opts.before))
    }
    if (opts?.limit !== undefined && opts?.limit !== null) {
      params.set('limit', String(opts.limit))
    }
    const qs = params.toString()
    return get<BackendInterestDistribution[]>(
      qs ? `/api/interest?${qs}` : '/api/interest',
      [],
      arrayOf(isBackendInterestDistribution),
      options
    )
  },

  markNotificationRead: (
    id: number,
    signer: AuthSigner,
    options?: BackendRequestOptions | AbortSignal
  ) => patch(`/api/notifications/${id}/read`, signer, options),

  markAllNotificationsRead: (
    address: string,
    signer: AuthSigner,
    options?: BackendRequestOptions | AbortSignal
  ) =>
    patch(`/api/notifications/read-all?address=${encodeURIComponent(address)}`, signer, options),

  getFailedEvents: (options?: BackendRequestOptions | AbortSignal) =>
    get<BackendFailedEvent[]>('/api/admin/failed-events', [], arrayOf(isBackendFailedEvent), options),

  getDocumentHistory: (
    kind: string,
    proposalId: number,
    options?: BackendRequestOptions | AbortSignal
  ) => {
    const params = new URLSearchParams({ kind, proposal_id: String(proposalId) })
    return get<BackendDocumentAttachment[]>(
      `/api/documents?${params.toString()}`,
      [],
      arrayOf(isBackendDocumentAttachment),
      options
    )
  },

  getLoanTimeline: (id: number, options?: BackendRequestOptions | AbortSignal) =>
    get<BackendTimelineEvent[]>(`/api/loans/${id}/timeline`, [], arrayOf(isBackendTimelineEvent), options),

  getTreasuryTimeline: (id: number, options?: BackendRequestOptions | AbortSignal) =>
    get<BackendTimelineEvent[]>(
      `/api/proposals/treasury/${id}/timeline`,
      [],
      arrayOf(isBackendTimelineEvent),
      options
    ),

  // The active member directory. The contract keeps no queryable member list,
  // so this is the only way to show who is in the DAO.
  getMembers: (limit = 50, options?: BackendRequestOptions | AbortSignal) =>
    get<BackendMember[]>(
      `/api/members?limit=${limit}`,
      [],
      arrayOf(isBackendMember),
      options
    ),

  getMemberSummary: (address: string, options?: BackendRequestOptions | AbortSignal) =>
    get<BackendMemberSummary | null>(
      `/api/members/${encodeURIComponent(address)}/summary`,
      null,
      (value): value is BackendMemberSummary | null => value === null || isBackendMemberSummary(value),
      options
    ),

  getMemberActivity: (address: string, limit = 50, options?: BackendRequestOptions | AbortSignal) =>
    get<BackendEvent[]>(
      `/api/members/${encodeURIComponent(address)}/activity?limit=${limit}`,
      [],
      arrayOf(isBackendEvent),
      options
    ),
}

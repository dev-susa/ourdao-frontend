
/**
 * Calculates member voting weight based on documented staking formula:
 * 1 base vote + 1 bonus vote per 100 token units (100 * 10^decimals stroops) staked,
 * capped at a maximum of 6 votes (1 base + 5 bonus).
 */
export function calculateVotingWeight(stakeStroops: bigint, decimals: number = 7): number {
  const STROOPS_PER_BONUS = BigInt(100) * (BigInt(10) ** BigInt(decimals))
  if (stakeStroops <= BigInt(0)) return 1
  const bonus = Number(stakeStroops / STROOPS_PER_BONUS)
  return 1 + Math.min(5, Math.max(0, bonus))
}
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWallet } from '@/lib/wallet'
import { CONTRACT_ID, isContractConfigured } from '@/lib/stellar'
import { daoRead } from '@/lib/dao-client'
import { backend } from '@/lib/backend'
import type { UserData, DAOStats } from '@/types/dao'
import { asBigInt, mapLoanTerms, resolveLoanPolicy, toLoan, toMemberStatus } from '@/lib/dao-mappers'
import type { UILoanPolicy, UILoanTerms } from '@/lib/dao-mappers'
import { queryKeys } from '@/lib/query-keys'
import { QUERY_REFRESH_INTERVAL_MS } from '@/constants'

function isBackendConfigured(): boolean {
  if (backend && typeof (backend as { isConfigured?: () => boolean }).isConfigured === 'function') {
    return (backend as { isConfigured: () => boolean }).isConfigured()
  }
  if (process.env.NEXT_PUBLIC_BACKEND_URL === '') return false
  if (process.env.NEXT_PUBLIC_BACKEND_URL) return true
  return process.env.NODE_ENV === 'test' && !!backend
}

export function useDAOContract() {
  return { contractId: CONTRACT_ID, configured: isContractConfigured() }
}

/** Aggregated data for the connected member. */
export function useUserData(): UserData {
  const { address, isConnected, isRestoring } = useWallet()

  const { data, isLoading, isError, refetch: refetchUser } = useQuery({
    queryKey: address ? queryKeys.userData(address) : queryKeys.userDataDisabled(),
    enabled: !!address && isContractConfigured(),
    queryFn: async () => {
      const [isMember, isAdmin, member, pendingYield, exitShare, stakeAmount] = await Promise.all([
        daoRead.isMember(address!),
        daoRead.isAdmin(address!),
        daoRead.getMember(address!),
        daoRead.getPendingYield(address!),
        daoRead.calculateExitShare ? daoRead.calculateExitShare(address!).catch(() => null) : Promise.resolve(null),
        daoRead.getStake ? daoRead.getStake(address!).catch(() => BigInt(0)) : Promise.resolve(BigInt(0)),
      ])
      return { isMember, isAdmin, member, pendingYield, exitShare, stakeAmount }
    },
  })

  const isMember = !!data?.isMember
  const backendConfigured = isBackendConfigured()

  // Loan history comes from the off-chain indexer (the contract keeps no
  // queryable per-member loan list).
  // Issue #242: Gated on backend configuration and membership:
  // - If backend is unconfigured, do not poll.
  // - A connected non-member does not poll for loan history (when contract is configured).
  const { data: loans, isError: loansError, refetch: refetchLoans } = useQuery({
    queryKey: address ? queryKeys.userLoans(address) : queryKeys.userLoansDisabled(),
    enabled: !!address && backendConfigured && (!isContractConfigured() || isMember),
    queryFn: ({ signal }) => backend.getLoans(address!, { signal }),
    refetchInterval: () => {
      if (!backendConfigured || !isMember) return false
      return QUERY_REFRESH_INTERVAL_MS
    },
    refetchIntervalInBackground: false,
  })

  const m = data?.member
  return {
    isConnected,
    // `isRestoring` is folded in on purpose (#307). Freighter's `isAllowed()`
    // and `getAddress()` are async, so on a hard refresh the first render or
    // two has `isConnected === false` for a wallet that is in fact connected.
    // A guard reading only the query's `isLoading` sees a *disabled* query
    // (isLoading false) with no data, concludes "not a member", and redirects a
    // connected member to /register — or / — before the address ever arrives.
    // Callers get one flag that means "membership is not knowable yet".
    isLoading: isRestoring || isLoading,
    address: address || undefined,
    isMember: !!data?.isMember,
    isAdmin: !!data?.isAdmin,
    member: m
      ? {
          memberAddress: String(m.address ?? address),
          status: toMemberStatus(m.status),
          joinDate: Number(m.join_time ?? 0),
          contributionAmount: asBigInt(m.contribution),
          // Member.share_balance in ourdao-contracts is a dead field (only set at join/exit, never updated).
          // Paired contract issue: https://github.com/Mikey-222/ourdao-contracts/issues/42
          // We query daoRead.calculateExitShare(address) to compute the member's live treasury claim.
          shareBalance: asBigInt(data?.exitShare ?? m.share_balance),
          hasActiveLoan: !!m.has_active_loan,
          lastLoanDate: Number(m.last_loan_time ?? 0),
        }
      : undefined,
    votingWeight: isMember ? calculateVotingWeight(asBigInt(data?.stakeAmount)) : 0,
    pendingYield: asBigInt(data?.pendingYield),
    hasActiveLoan: !!m?.has_active_loan,
    loans: (loans ?? []).map(toLoan),
    isError,
    loansError,
    refetch: () => {
      if (isError) void refetchUser()
      if (loansError) void refetchLoans()
    },
  }
}

export type ExtendedStats = DAOStats & {
  initialized: boolean
  isPaused: boolean
  membershipFee: bigint
  /** Policy cap on a loan as basis points of the treasury balance. */
  maxLoanToTreasuryRatio: number
  consensusThreshold: number
  indexerStale: boolean
  lastIndexedLedger: number | null
  indexerError: boolean
  /** A stats read failed, so the figures below are defaults, not the DAO's real numbers. */
  isError: boolean
  refetch: () => void
  secondsSinceUpdate: number | null
  interestCollected: string
  principalLent: string
  principalRepaid: string
  valueDefaulted: string
  defaultedLoans: number
  totalDefaultedValue: string
  features: {
    ensVoting: boolean
    documentStorage: boolean
    privateVoting: boolean
    confidentialLoans: boolean
    restaking: boolean
  }
}

/** The loan policy as the contract currently has it. An admin can change it at
 *  any time, so it is refetched rather than cached forever; until the first
 *  read lands the labelled fallbacks stand in (`fromChain` is false). */
export function useLoanPolicy(): UILoanPolicy {
  const { data } = useQuery({
    queryKey: queryKeys.loanPolicy(),
    enabled: isContractConfigured(),
    queryFn: async () => {
      const [policy, threshold] = await Promise.all([
        daoRead.getLoanPolicy(),
        daoRead.getConsensusThreshold(),
      ])
      return { policy, threshold }
    },
  })
  return resolveLoanPolicy(data?.policy, data?.threshold)
}

/** Wait this long after the amount stops changing before pricing it, so
 *  typing an amount doesn't fire a simulation per keystroke. */
const LOAN_TERMS_DEBOUNCE_MS = 300

/** The terms the contract would set for a loan of `amount` (stroops), read
 *  from `calculate_loan_terms`. The rate depends on the amount relative to the
 *  live treasury, so it can't be derived client-side. Pass null to skip. */
export function useLoanTerms(amount: bigint | null): {
  terms: UILoanTerms | null
  isLoading: boolean
  isError: boolean
} {
  const [debounced, setDebounced] = useState(amount)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(amount), LOAN_TERMS_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [amount])

  // Terms for a previous amount must never be shown against the current one.
  const settled = debounced === amount
  const enabled = isContractConfigured() && debounced !== null && debounced > BigInt(0)

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.loanTerms(debounced ?? BigInt(0)),
    enabled,
    queryFn: async () => {
      const raw = await daoRead.calculateLoanTerms(debounced!)
      if (!raw) throw new Error('Loan terms are unavailable')
      return mapLoanTerms(raw)
    },
  })

  return {
    terms: settled && enabled && data ? data : null,
    isLoading: amount !== null && amount > BigInt(0) && (!settled || (enabled && isLoading)),
    isError: settled && enabled && isError,
  }
}

// --- Loan eligibility ---------------------------------------------------------

/** Why the contract's `is_eligible_for_loan` said no. `unknown` covers the
 *  cases the view's boolean can't explain (a member who isn't active, or a
 *  treasury ratio the caller has to check against its own amount). */
export type LoanIneligibilityReason = 'active-loan' | 'too-new' | 'cooling-down' | 'unknown'

export type LoanEligibility =
  | { eligible: true }
  | { eligible: false; reason: LoanIneligibilityReason; eligibleAt: number | null }

interface EligibilityData {
  eligible: boolean
  policy: Record<string, unknown> | null
  member: Record<string, unknown> | null
}

/**
 * Derive *why* a member is not eligible, from the same fields the contract's
 * `is_eligible_for_loan` checks (ourdao-contracts loans.rs):
 *   - an active loan,
 *   - `now - join_time < min_membership_duration`,
 *   - `last_loan_time != 0 && now - last_loan_time < cooldown_period`.
 * `eligibleAt` is the unix second the member becomes eligible, when the reason
 * is a waiting period.
 */
export function deriveLoanEligibility(data: EligibilityData | undefined): LoanEligibility {
  if (!data || data.eligible) return { eligible: true }
  const now = Math.floor(Date.now() / 1000)
  const policy = data.policy ?? {}
  const member = data.member ?? {}

  if (member.has_active_loan) return { eligible: false, reason: 'active-loan', eligibleAt: null }

  const joinTime = Number(member.join_time ?? 0)
  const minMembershipDuration = Number(policy.min_membership_duration ?? 0)
  if (joinTime > 0 && minMembershipDuration > 0 && now - joinTime < minMembershipDuration) {
    return { eligible: false, reason: 'too-new', eligibleAt: joinTime + minMembershipDuration }
  }

  const lastLoanTime = Number(member.last_loan_time ?? 0)
  const cooldownPeriod = Number(policy.cooldown_period ?? 0)
  if (lastLoanTime > 0 && cooldownPeriod > 0 && now - lastLoanTime < cooldownPeriod) {
    return { eligible: false, reason: 'cooling-down', eligibleAt: lastLoanTime + cooldownPeriod }
  }

  return { eligible: false, reason: 'unknown', eligibleAt: null }
}

/** One-line explanation for the wizard's blocking card. */
export function describeLoanIneligibility(eligibility: LoanEligibility): string {
  if (eligibility.eligible) return ''
  switch (eligibility.reason) {
    case 'active-loan':
      return 'You already have an active loan. Repay it before requesting another.'
    case 'too-new':
      return 'New members must be part of the DAO for a minimum period before they can request a loan.'
    case 'cooling-down':
      return 'There is a cooldown between loans. You can request again once it has passed.'
    default:
      return 'The contract does not consider you eligible to request a loan right now.'
  }
}

/**
 * Whether the connected member may request a loan *right now*, checked against
 * the contract's own `is_eligible_for_loan` instead of the page's single
 * `hasActiveLoan` flag. The wizard used to let a member fill in all four steps,
 * upload documents and sign, then fail on-chain with a generic error (#392).
 *
 * While the read is in flight `eligibility` is `{ eligible: true }`, so the
 * caller must gate on `isLoading` rather than on the value alone.
 */
export function useLoanEligibility(): {
  eligibility: LoanEligibility
  isLoading: boolean
  isError: boolean
} {
  const { address } = useWallet()
  const enabled = !!address && isContractConfigured()
  const { data, isLoading, isError } = useQuery({
    queryKey: address ? queryKeys.loanEligibility(address) : queryKeys.loanEligibilityDisabled(),
    enabled,
    queryFn: async (): Promise<EligibilityData> => {
      const [eligible, policy, member] = await Promise.all([
        daoRead.isEligibleForLoan(address!),
        daoRead.getLoanPolicy().catch(() => null),
        daoRead.getMember(address!).catch(() => null),
      ])
      // `read` resolves to null when no contract is configured; that is not a
      // "no" from the contract, so don't block on it.
      return { eligible: eligible ?? true, policy, member }
    },
  })

  const eligibility = useMemo(() => deriveLoanEligibility(data), [data])
  return { eligibility, isLoading: enabled && isLoading, isError }
}

export function useDAOStats(): ExtendedStats & { isLoading: boolean } {
  const { data, isLoading: contractLoading, isError: contractError, refetch: refetchContract } = useQuery({
    queryKey: queryKeys.daoStats(),
    enabled: isContractConfigured(),
    queryFn: async () => {
      const [totalMembers, activeMembers, threshold, treasury, policy, isPaused] =
        await Promise.all([
          daoRead.getTotalMembers(),
          daoRead.getActiveMembers(),
          daoRead.getConsensusThreshold(),
          daoRead.getTreasuryBalance(),
          daoRead.getLoanPolicy(),
          daoRead.isPaused(),
        ])
      return { totalMembers, activeMembers, threshold, treasury, policy, isPaused }
    },
  })

  // Loan counts and total stake are aggregated by the off-chain indexer, which
  // sees the full event history the contract doesn't keep queryable.
  const backendConfigured = isBackendConfigured()
  const { data: agg, isError: indexerError, refetch: refetchIndexer } = useQuery({
    queryKey: queryKeys.daoStatsBackend(),
    enabled: backendConfigured,
    queryFn: ({ signal }) => backend.getStats({ signal }),
    refetchInterval: backendConfigured ? QUERY_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  })

  const membershipFee = asBigInt(
    (data?.policy as Record<string, unknown> | undefined)?.membership_contribution
  )

  const maxLoanToTreasuryRatio = Number(
    (data?.policy as Record<string, unknown> | undefined)?.max_loan_to_treasury_ratio ?? 0
  )

  return {
    totalMembers: Number(data?.totalMembers ?? 0),
    activeMembers: Number(data?.activeMembers ?? 0),
    totalLoans: agg?.totalLoans ?? 0,
    activeLoans: agg?.activeLoans ?? 0,
    treasuryBalance: asBigInt(data?.treasury),
    totalYieldGenerated: BigInt(0),
    totalRestaked: asBigInt(agg?.totalStaked),
    initialized: isContractConfigured() && data?.threshold != null,
    isPaused: !!data?.isPaused,
    membershipFee,
    maxLoanToTreasuryRatio,
    consensusThreshold: Number(data?.threshold ?? 0),
    indexerStale: agg?.indexerStale ?? false,
    lastIndexedLedger: agg?.lastIndexedLedger ?? null,
    indexerError,
    isLoading: contractLoading,
    isError: contractError || indexerError,
    refetch: () => {
      if (contractError) void refetchContract()
      if (indexerError) void refetchIndexer()
    },
    secondsSinceUpdate: agg?.secondsSinceUpdate ?? null,
    interestCollected: agg?.interestCollected ?? '0',
    principalLent: agg?.principalLent ?? '0',
    principalRepaid: agg?.principalRepaid ?? '0',
    valueDefaulted: agg?.valueDefaulted ?? '0',
    defaultedLoans: agg?.defaultedLoans ?? 0,
    totalDefaultedValue: agg?.totalDefaultedValue ?? '0',
    // The Soroban port's native modules are always compiled in.
    features: {
      ensVoting: true, // name registry
      documentStorage: true, // content-hash metadata
      privateVoting: true, // commit-reveal
      confidentialLoans: false,
      restaking: true, // staking
    },
  }
}

// Contract events, indexed off-chain by ourdao-backend (which polls the RPC's
// getEvents) and served from its raw event feed. Kept read-only; `setEvents`
// remains for call-site compatibility with the previous shell.
export function useDAOEvents() {
  const backendConfigured = isBackendConfigured()
  const { data, isError, refetch } = useQuery({
    queryKey: queryKeys.daoEvents(),
    enabled: backendConfigured,
    queryFn: ({ signal }) => backend.getEvents(50, undefined, { signal }),
    refetchInterval: backendConfigured ? QUERY_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  })
  const events = (data ?? []) as unknown as Record<string, unknown>[]
  const setEvents = () => {}
  return { events, setEvents, isError, refetch }
}

/** Interest distributions history from ourdao-backend with optional cursor pagination. */
export function useInterestDistributions(options?: { before?: number; limit?: number }) {
  const backendConfigured = isBackendConfigured()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.interestDistributions(options?.before),
    enabled: backendConfigured,
    queryFn: ({ signal }) => backend.getInterestDistributions(options, { signal }),
    refetchInterval: backendConfigured ? QUERY_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  })

  return {
    distributions: data ?? [],
    isLoading,
    isError,
    refetch,
  }
}

export function useMemberSummary(address?: string | null) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: address ? queryKeys.memberSummary(address) : ['memberSummary', null],
    queryFn: ({ signal }) => (address ? backend.getMemberSummary(address, { signal }) : null),
    enabled: !!address,
    refetchInterval: QUERY_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
  return {
    summary: data,
    isLoading,
    isError,
    refetch,
  }
}

export function useMemberActivity(address?: string | null, limit = 50) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: address ? queryKeys.memberActivity(address, limit) : ['memberActivity', null, limit],
    queryFn: ({ signal }) => (address ? backend.getMemberActivity(address, limit, { signal }) : []),
    enabled: !!address,
    refetchInterval: QUERY_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  })
  return {
    activity: data ?? [],
    isLoading,
    isError,
    refetch,
  }
}

/** The active member directory from the off-chain indexer. The contract keeps
 *  no queryable member list, so this is the only source for a members page. */
export function useMembers(limit = 50) {
  const backendConfigured = isBackendConfigured()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.members(limit),
    enabled: backendConfigured,
    queryFn: ({ signal }) => backend.getMembers(limit, { signal }),
    refetchInterval: backendConfigured ? QUERY_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  })
  return {
    members: data ?? [],
    isLoading,
    isError,
    refetch,
  }
}

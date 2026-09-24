export interface Member {
  memberAddress: string
  status: MemberStatus
  joinDate: number
  contributionAmount: bigint
  shareBalance: bigint
  hasActiveLoan: boolean
  lastLoanDate: number
}

export enum MemberStatus {
  ACTIVE_MEMBER = 1,
  INACTIVE_MEMBER = 2,
}

export interface Loan {
  id: number
  borrower: string
  amount: bigint
  interestRate: number
  repaymentTerm: number
  startTime: number
  endTime: number
  amountPaid: bigint
  totalInterest: bigint
  isActive: boolean
  collateralAmount: bigint
}

export interface DAOStats {
  totalMembers: number
  activeMembers: number
  totalLoans: number
  activeLoans: number
  treasuryBalance: bigint
  totalYieldGenerated: bigint
  totalRestaked: bigint
}

export interface UserData {
  isConnected: boolean
  address?: string
  isLoading: boolean
  isMember: boolean
  isAdmin: boolean
  member?: Member
  ensName?: string
  votingWeight: number
  pendingRewards: bigint
  pendingYield: bigint
  hasActiveLoan: boolean
  loans: Loan[]
}

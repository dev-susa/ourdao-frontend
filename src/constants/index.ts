export const DAO_CONSTANTS = {
  PROPOSAL_EDITING_PERIOD: 3 * 24 * 60 * 60, // 3 days in seconds
  VOTING_PERIOD: 7 * 24 * 60 * 60, // 7 days in seconds
  BASIS_POINTS: 10000,
  DEFAULT_CONSENSUS_THRESHOLD: 5100, // 51%
  MAX_LOAN_AMOUNT: '1000', // in DAO token units
  MIN_INTEREST_RATE: 500, // 5% in basis points
  MAX_INTEREST_RATE: 2000, // 20% in basis points
  DEFAULT_REPAYMENT_TERM: 365 * 24 * 60 * 60, // 1 year in seconds
} as const

export const MEMBER_STATUS_LABELS = {
  1: 'Active Member',
  2: 'Inactive Member',
} as const

// A non-member has no contract record at all, so there is no status code for it.
export const NON_MEMBER_LABEL = 'Non-Member'

export const PROPOSAL_STATUS_LABELS = {
  0: 'Pending',
  1: 'In Editing',
  2: 'In Voting',
  3: 'Approved',
  4: 'Rejected',
  5: 'Executed',
  6: 'Cancelled',
  7: 'Awaiting Funds',
} as const

/** Approved by vote, but the treasury was too small to pay out; the contract
 *  keeps the proposal as `ApprovedPendingDisbursement` until it is funded. */
export const PROPOSAL_STATUS_AWAITING_FUNDS = 7

export const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/'

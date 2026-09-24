export const DAO_CONSTANTS = {
  PROPOSAL_EDITING_PERIOD: 3 * 24 * 60 * 60, // 3 days in seconds
  VOTING_PERIOD: 7 * 24 * 60 * 60, // 7 days in seconds
  BASIS_POINTS: 10000,
  DEFAULT_CONSENSUS_THRESHOLD: 5100, // 51%
  MIN_INTEREST_RATE: 500, // 5% in basis points
  MAX_INTEREST_RATE: 2000, // 20% in basis points
  DEFAULT_REPAYMENT_TERM: 365 * 24 * 60 * 60, // 1 year in seconds
} as const

export const MEMBER_STATUS_LABELS = {
  0: 'Non-Member',
  1: 'Active Member',
  2: 'Inactive Member',
  3: 'Suspended Member',
} as const

export const PROPOSAL_STATUS_LABELS = {
  0: 'Pending',
  1: 'In Editing',
  2: 'In Voting',
  3: 'Approved',
  4: 'Rejected',
  5: 'Executed',
  7: 'Awaiting Funds',
} as const

/** Approved by vote, but the treasury was too small to pay out; the contract
 *  keeps the proposal as `ApprovedPendingDisbursement` until it is funded. */
export const PROPOSAL_STATUS_AWAITING_FUNDS = 7

const DEFAULT_IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/'

/** Parse a comma-separated gateway list, dropping blanks and adding a trailing
 *  slash so `${gateway}${cid}` is always well-formed. Falls back to the default. */
export function parseGatewayList(raw: string | undefined): string[] {
  const list = (raw ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
    .map((g) => (g.endsWith('/') ? g : `${g}/`))
  return list.length > 0 ? list : [DEFAULT_IPFS_GATEWAY]
}

/** Read gateways in priority order; NEXT_PUBLIC_IPFS_GATEWAY may list several. */
export const IPFS_GATEWAYS = parseGatewayList(process.env.NEXT_PUBLIC_IPFS_GATEWAY)

/** Primary gateway, used for links shown to the user. */
export const IPFS_GATEWAY = IPFS_GATEWAYS[0]

/** Give up on one gateway after this long and move on to the next. */
export const IPFS_GATEWAY_TIMEOUT_MS = 10_000

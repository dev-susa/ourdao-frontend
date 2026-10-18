import type { UILoanProposal } from '@/hooks/useDAO'

export type LoanStatusFilter = 'all' | 'editing' | 'voting' | 'approved' | 'rejected'

export interface LoanFilters {
  status: LoanStatusFilter
  search: string
}

const STATUS_CODES: Record<Exclude<LoanStatusFilter, 'all'>, number> = {
  editing: 1,
  voting: 2,
  approved: 3,
  rejected: 4,
}

/**
 * Filters loan proposals by status and by a free-text search over the fields
 * the app actually populates: borrower address and proposal id.
 */
export function filterLoanProposals(
  proposals: UILoanProposal[],
  { status, search }: LoanFilters
): UILoanProposal[] {
  const query = search.trim().toLowerCase().replace(/^#/, '')
  return proposals.filter((p) => {
    if (status !== 'all' && p.status !== STATUS_CODES[status]) return false
    if (!query) return true
    return p.borrower.toLowerCase().includes(query) || String(p.id) === query
  })
}

import { describe, expect, it } from 'vitest'
import { filterLoanProposals } from '@/lib/loan-filters'
import { mapLoanProposal } from '@/hooks/useDAO'

const proposals = [
  mapLoanProposal({ id: 1, borrower: 'GABCDEF', amount: '100', phase: ['Editing'], status: ['Pending'] }),
  mapLoanProposal({ id: 12, borrower: 'GXYZKLM', amount: '200', phase: ['Voting'], status: ['Pending'] }),
  mapLoanProposal({ id: 3, borrower: 'GABDEFG', amount: '300', phase: ['Voting'], status: ['Rejected'] }),
]

const ids = (list: { id: number }[]) => list.map((p) => p.id)

describe('filterLoanProposals', () => {
  it('returns everything with no filters', () => {
    expect(ids(filterLoanProposals(proposals, { status: 'all', search: '' }))).toEqual([1, 12, 3])
  })

  it('searches borrower address case-insensitively', () => {
    expect(ids(filterLoanProposals(proposals, { status: 'all', search: 'gab' }))).toEqual([1, 3])
  })

  it('matches proposal id exactly, with or without a leading #', () => {
    expect(ids(filterLoanProposals(proposals, { status: 'all', search: '1' }))).toEqual([1])
    expect(ids(filterLoanProposals(proposals, { status: 'all', search: '#12' }))).toEqual([12])
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(ids(filterLoanProposals(proposals, { status: 'all', search: '  GXYZ ' }))).toEqual([12])
  })

  it('combines status and search', () => {
    expect(ids(filterLoanProposals(proposals, { status: 'rejected', search: 'gab' }))).toEqual([3])
    expect(filterLoanProposals(proposals, { status: 'voting', search: 'gab' })).toEqual([])
  })

  it.each([
    ['editing', [1]],
    ['voting', [12]],
    ['rejected', [3]],
    ['approved', []],
  ] as const)('filters by status %s', (status, expected) => {
    expect(ids(filterLoanProposals(proposals, { status, search: '' }))).toEqual(expected)
  })
})

import { describe, expect, expectTypeOf, it } from 'vitest'
import type { paths } from '@/lib/generated/backend-api'
import { isBackendLoan, isBackendStats, type BackendLoan, type BackendStats } from '@/lib/backend'

/**
 * Covers the types derived from the committed ourdao-backend OpenAPI spec (#343).
 * Compile-time assertions fail `npm run typecheck`; the runtime checks confirm the
 * guards accept the spec-shaped payloads the derived types describe.
 */

const LOAN_FIXTURE = {
  id: 1,
  borrower: 'GBORROWER',
  amount: '1000',
  outstanding: '1000',
  total_repayment: '1100',
  due_time: 1_700_000_000,
  status: 'active',
  approved_ledger: 10,
  repaid_ledger: null,
  defaulted_ledger: null,
  updated_at: '2026-10-01T00:00:00Z',
  interest_charge: '100',
  repaid_amount: null,
  repayment_progress_bps: 0,
}

const STATS_FIXTURE = {
  totalMembers: 12,
  activeMembers: 10,
  totalLoanProposals: 5,
  totalLoans: 3,
  activeLoans: 2,
  defaultedLoans: 1,
  totalTreasuryProposals: 4,
  totalStaked: '1000000000',
  totalDefaultedValue: '5000000',
  interestCollected: '1200000',
  principalLent: '50000000',
  principalRepaid: '25000000',
  valueDefaulted: '5000000',
  lastIndexedLedger: 123456,
  secondsSinceUpdate: 15,
  indexerStale: false,
}

describe('generated backend API types', () => {
  it('derives the stats response from the spec path', () => {
    expectTypeOf<paths['/api/stats']>().toHaveProperty('get')
    expectTypeOf<BackendStats['totalMembers']>().toEqualTypeOf<number>()
    expectTypeOf<BackendStats['totalStaked']>().toEqualTypeOf<string>()
  })

  it('keeps the spec-gap stats fields required', () => {
    expectTypeOf<BackendStats['lastIndexedLedger']>().toEqualTypeOf<number | null>()
    expectTypeOf<BackendStats['indexerStale']>().toEqualTypeOf<boolean>()
  })

  it('derives loan status and nullability from the spec', () => {
    expectTypeOf<BackendLoan['status']>().toEqualTypeOf<'active' | 'repaid' | 'defaulted'>()
    expectTypeOf<BackendLoan['approved_ledger']>().toEqualTypeOf<number | null>()
    expectTypeOf<BackendLoan['interest_charge']>().toEqualTypeOf<string | null | undefined>()
  })

  it('applies the due_time override the app relies on', () => {
    expectTypeOf<BackendLoan['due_time']>().toEqualTypeOf<number | null>()
  })

  it('runtime guards accept spec-shaped payloads', () => {
    expect(isBackendLoan(LOAN_FIXTURE)).toBe(true)
    expect(isBackendStats(STATS_FIXTURE)).toBe(true)
  })
})

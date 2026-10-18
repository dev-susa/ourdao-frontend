// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/AppShell'
import { backend } from '@/lib/backend'

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: 'GABROWSER123',
    isConnected: true,
  }),
}))

vi.mock('@/lib/stellar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar')>()
  return {
    ...actual,
    CONTRACT_ID: 'CCONTRACT123',
    isContractConfigured: () => true,
  }
})

describe('AppShell - Indexer staleness warning banner', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  it('renders indexer staleness banner when indexerStale is true', async () => {
    vi.spyOn(backend, 'getStats').mockResolvedValue({
      totalMembers: 10,
      activeMembers: 8,
      totalLoanProposals: 2,
      totalLoans: 2,
      activeLoans: 1,
      defaultedLoans: 0,
      totalTreasuryProposals: 1,
      totalStaked: '100',
      lastIndexedLedger: 500,
      secondsSinceUpdate: 120,
      indexerStale: true,
      totalDefaultedValue: '0',
      interestCollected: '0',
      principalLent: '0',
      principalRepaid: '0',
      valueDefaulted: '0',
    })

    render(
      <AppShell>
        <div>Test Page</div>
      </AppShell>,
      { wrapper }
    )

    await waitFor(() => {
      expect(screen.getByTestId('indexer-stale-banner')).toBeDefined()
    })

    expect(screen.getByTestId('indexer-stale-banner').textContent).toContain(
      'Indexer data is stale (last updated 120s ago)'
    )
  })

  it('does not render indexer staleness banner when indexerStale is false', async () => {
    vi.spyOn(backend, 'getStats').mockResolvedValue({
      totalMembers: 10,
      activeMembers: 8,
      totalLoanProposals: 2,
      totalLoans: 2,
      activeLoans: 1,
      defaultedLoans: 0,
      totalTreasuryProposals: 1,
      totalStaked: '100',
      lastIndexedLedger: 500,
      secondsSinceUpdate: 5,
      indexerStale: false,
      totalDefaultedValue: '0',
      interestCollected: '0',
      principalLent: '0',
      principalRepaid: '0',
      valueDefaulted: '0',
    })

    render(
      <AppShell>
        <div>Test Page</div>
      </AppShell>,
      { wrapper }
    )

    await waitFor(() => {
      expect(screen.queryByTestId('indexer-stale-banner')).toBeNull()
    })
  })

  it('renders lastIndexedLedger in the staleness banner when available', async () => {
    vi.spyOn(backend, 'getStats').mockResolvedValue({
      totalMembers: 10,
      activeMembers: 8,
      totalLoanProposals: 2,
      totalLoans: 2,
      activeLoans: 1,
      defaultedLoans: 0,
      totalTreasuryProposals: 1,
      totalStaked: '100',
      lastIndexedLedger: 12345,
      secondsSinceUpdate: 120,
      indexerStale: true,
      totalDefaultedValue: '0',
      interestCollected: '0',
      principalLent: '0',
      principalRepaid: '0',
      valueDefaulted: '0',
    })

    render(
      <AppShell>
        <div>Test Page</div>
      </AppShell>,
      { wrapper }
    )

    await waitFor(() => {
      expect(screen.getByTestId('indexer-stale-banner')).toBeDefined()
    })

    expect(screen.getByTestId('indexer-stale-banner').textContent).toContain('last ledger #12345')
  })
})

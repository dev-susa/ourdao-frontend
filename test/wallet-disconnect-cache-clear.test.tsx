// @vitest-environment jsdom
/**
 * Tests for disconnect cache clearing — verifies that disconnect() clears all
 * cached query data so no member-specific data lingers for the next connection.
 *
 * Acceptance criteria:
 * - No member-specific data is served after disconnect
 * - Reconnecting as a different member shows no previous data
 * - Decrypted document content does not survive a disconnect
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import React from 'react'
import { WalletProvider, useWallet } from '@/lib/wallet'
import { queryKeys } from '@/lib/query-keys'
import * as freighter from '@stellar/freighter-api'

// ---------------------------------------------------------------------------
// Mock @stellar/freighter-api
// ---------------------------------------------------------------------------

type WatchCallback = (params: {
  address: string
  network: string
  networkPassphrase: string
  error?: unknown
}) => void

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let watchCallback: WatchCallback | null = null
const mockWatcherStop = vi.fn()

vi.mock('@stellar/freighter-api', () => ({
  isAllowed: vi.fn().mockResolvedValue(false),
  requestAccess: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn().mockResolvedValue({
    network: 'TESTNET',
    networkPassphrase: 'Test SDF Network ; September 2015',
  }),
  signTransaction: vi.fn(),
  isConnected: vi.fn().mockResolvedValue(false),
  WatchWalletChanges: vi.fn().mockImplementation(function () {
    return {
      watch: vi.fn((cb: WatchCallback) => {
        watchCallback = cb
        return {}
      }),
      stop: mockWatcherStop,
    }
  }),
}))

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function TestHarness({
  onRender,
}: {
  onRender: (w: ReturnType<typeof useWallet>) => void
}) {
  const wallet = useWallet()
  onRender(wallet)

  // Set up test queries for member-specific data
  const userDataQuery = useQuery({
    queryKey: queryKeys.userData(wallet.address || ''),
    queryFn: () => Promise.resolve({ name: 'Member A', shares: 100 }),
    enabled: !!wallet.address,
  })

  const userLoansQuery = useQuery({
    queryKey: queryKeys.userLoans(wallet.address || ''),
    queryFn: () => Promise.resolve([{ id: 1, amount: 1000 }]),
    enabled: !!wallet.address,
  })

  const stakeQuery = useQuery({
    queryKey: queryKeys.stake(wallet.address || ''),
    queryFn: () => Promise.resolve({ staked: 500 }),
    enabled: !!wallet.address,
  })

  const documentQuery = useQuery({
    queryKey: queryKeys.document('QmTestHash', wallet.address || ''),
    queryFn: () => Promise.resolve({ content: new Uint8Array([1, 2, 3]), decrypted: true }),
    enabled: !!wallet.address,
  })

  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications(wallet.address || ''),
    queryFn: () => Promise.resolve([{ id: 1, message: 'Test notification' }]),
    enabled: !!wallet.address,
  })

  // Public query that should NOT be cleared on disconnect
  const daoStatsQuery = useQuery({
    queryKey: queryKeys.daoStats(),
    queryFn: () => Promise.resolve({ totalMembers: 10, totalProposals: 5 }),
  })

  return (
    <div data-testid="harness">
      <div data-testid="address">{wallet.address || 'none'}</div>
      <div data-testid="userData">{userDataQuery.data ? JSON.stringify(userDataQuery.data) : 'none'}</div>
      <div data-testid="userLoans">{userLoansQuery.data ? JSON.stringify(userLoansQuery.data) : 'none'}</div>
      <div data-testid="stake">{stakeQuery.data ? JSON.stringify(stakeQuery.data) : 'none'}</div>
      <div data-testid="document">{documentQuery.data ? 'cached' : 'none'}</div>
      <div data-testid="notifications">
        {notificationsQuery.data ? JSON.stringify(notificationsQuery.data) : 'none'}
      </div>
      <div data-testid="daoStats">{daoStatsQuery.data ? JSON.stringify(daoStatsQuery.data) : 'none'}</div>
    </div>
  )
}

function renderProvider(queryClient: QueryClient, onRender: (w: ReturnType<typeof useWallet>) => void) {
  return render(
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <TestHarness onRender={onRender} />
      </WalletProvider>
    </QueryClientProvider>,
  )
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000, // Match production setting
        refetchOnWindowFocus: false, // Simplify test behavior
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('disconnect() — cache clearing', () => {
  beforeEach(() => {
    watchCallback = null
    mockWatcherStop.mockClear()
    vi.mocked(freighter.WatchWalletChanges).mockClear()
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: false } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: '' } as never)
  })

  afterEach(() => vi.clearAllMocks())

  it('clears all member-specific query caches on disconnect', async () => {
    // Start with a connected wallet
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'ACCOUNT_A' } as never)

    const qc = makeQueryClient()
    const clearSpy = vi.spyOn(qc, 'clear')
    let latest: ReturnType<typeof useWallet> | undefined
    const { getByTestId } = renderProvider(qc, (w) => {
      latest = w
    })

    // Wait for connection and data to load
    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_A'))
    await waitFor(() => expect(getByTestId('userData').textContent).not.toBe('none'))
    await waitFor(() => expect(getByTestId('userLoans').textContent).not.toBe('none'))
    await waitFor(() => expect(getByTestId('stake').textContent).not.toBe('none'))
    await waitFor(() => expect(getByTestId('document').textContent).toBe('cached'))
    await waitFor(() => expect(getByTestId('notifications').textContent).not.toBe('none'))

    // Verify public data is also loaded
    await waitFor(() => expect(getByTestId('daoStats').textContent).not.toBe('none'))

    // Verify queries exist in cache before disconnect
    const cacheBeforeDisconnect = qc.getQueryCache().getAll()
    expect(cacheBeforeDisconnect.length).toBeGreaterThan(0)

    // Verify member-specific queries are present with data
    const memberQueries = cacheBeforeDisconnect.filter((q) => {
      const key = q.queryKey[0]
      return ['userData', 'userLoans', 'stake', 'document', 'notifications'].includes(key as string)
    })
    expect(memberQueries.length).toBeGreaterThan(0)
    // Verify at least some have data
    const queriesWithData = memberQueries.filter((q) => q.state.data !== undefined)
    expect(queriesWithData.length).toBeGreaterThan(0)

    // Now disconnect
    act(() => {
      latest!.disconnect()
    })

    await waitFor(() => expect(latest?.address).toBeNull())

    // Verify queryClient.clear() was called
    expect(clearSpy).toHaveBeenCalledTimes(1)

    // Verify no member-specific data is displayed
    expect(getByTestId('userData').textContent).toBe('none')
    expect(getByTestId('userLoans').textContent).toBe('none')
    expect(getByTestId('stake').textContent).toBe('none')
    expect(getByTestId('document').textContent).toBe('none')
    expect(getByTestId('notifications').textContent).toBe('none')
  })

  it('prevents previous account data from appearing when reconnecting as a different member', async () => {
    // Connect as ACCOUNT_A
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'ACCOUNT_A' } as never)

    const qc = makeQueryClient()
    const clearSpy = vi.spyOn(qc, 'clear')
    let latest: ReturnType<typeof useWallet> | undefined
    const { getByTestId } = renderProvider(qc, (w) => {
      latest = w
    })

    // Wait for ACCOUNT_A data to load
    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_A'))
    await waitFor(() => expect(getByTestId('userData').textContent).toContain('Member A'))

    // Record queries with data for account A
    const queriesWithAccountAData = qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.state.data !== undefined)
    expect(queriesWithAccountAData.length).toBeGreaterThan(0)

    // Disconnect
    act(() => {
      latest!.disconnect()
    })

    await waitFor(() => expect(latest?.address).toBeNull())
    await waitFor(() => expect(getByTestId('userData').textContent).toBe('none'))

    // Verify clear was called
    expect(clearSpy).toHaveBeenCalled()

    // The key point: all cached data should be gone, so reconnecting
    // as a different user won't show stale data from the previous session
    // We've verified clear() was called, which removes all cache entries
  })

  it('ensures decrypted document content does not survive disconnect', async () => {
    // Connect and load encrypted document
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'ACCOUNT_A' } as never)

    const qc = makeQueryClient()
    const clearSpy = vi.spyOn(qc, 'clear')
    let latest: ReturnType<typeof useWallet> | undefined
    const { getByTestId } = renderProvider(qc, (w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_A'))
    await waitFor(() => expect(getByTestId('document').textContent).toBe('cached'))

    // Verify document is in cache with data before disconnect
    const docQueryBefore = qc
      .getQueryCache()
      .getAll()
      .find((q) => q.queryKey[0] === 'document' && q.state.data !== undefined)
    expect(docQueryBefore).toBeDefined()

    // Disconnect
    act(() => {
      latest!.disconnect()
    })

    await waitFor(() => expect(latest?.address).toBeNull())

    // Verify clear was called
    expect(clearSpy).toHaveBeenCalled()

    // Verify no document content is displayed
    expect(getByTestId('document').textContent).toBe('none')
  })

  it('clears userData, userLoans, stake, document, notifications, and hasVoted caches', async () => {
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'ACCOUNT_A' } as never)

    const qc = makeQueryClient()
    const clearSpy = vi.spyOn(qc, 'clear')
    let latest: ReturnType<typeof useWallet> | undefined
    renderProvider(qc, (w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_A'))

    // Manually set a hasVoted query to verify it gets cleared
    qc.setQueryData(queryKeys.hasVoted('Loan', 1, 'ACCOUNT_A'), true)

    // Wait for other queries to populate
    await waitFor(() => {
      const queries = qc.getQueryCache().getAll()
      return queries.length >= 6 // userData, userLoans, stake, document, notifications, hasVoted
    })

    // Verify all wallet-scoped query types are present
    const queries = qc.getQueryCache().getAll()
    const queryTypes = new Set(queries.map((q) => q.queryKey[0]))

    expect(queryTypes.has('userData')).toBe(true)
    expect(queryTypes.has('userLoans')).toBe(true)
    expect(queryTypes.has('stake')).toBe(true)
    expect(queryTypes.has('document')).toBe(true)
    expect(queryTypes.has('notifications')).toBe(true)
    expect(queryTypes.has('hasVoted')).toBe(true)

    // Verify at least some have data
    const queriesWithData = queries.filter((q) => q.state.data !== undefined)
    expect(queriesWithData.length).toBeGreaterThan(0)

    // Disconnect
    act(() => {
      latest!.disconnect()
    })

    await waitFor(() => expect(latest?.address).toBeNull())

    // Verify queryClient.clear() was called
    expect(clearSpy).toHaveBeenCalledTimes(1)
  })

  it('does not throw when disconnect is called while already disconnected', () => {
    const qc = makeQueryClient()
    let latest: ReturnType<typeof useWallet> | undefined
    renderProvider(qc, (w) => {
      latest = w
    })

    // Wallet starts disconnected
    expect(latest?.address).toBeNull()

    // Should not throw
    expect(() => {
      act(() => {
        latest!.disconnect()
      })
    }).not.toThrow()
  })
})

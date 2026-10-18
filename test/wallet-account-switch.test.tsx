// @vitest-environment jsdom
/**
 * Tests for issue #59 — Freighter account switch updates the provider state
 * and invalidates wallet-scoped React Query caches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { WalletProvider, useWallet } from '@/lib/wallet'
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

// Shared handle so tests can drive the watcher.
let watchCallback: WatchCallback | null = null
const mockWatcherStop = vi.fn()

vi.mock('@stellar/freighter-api', () => ({
  isAllowed: vi.fn().mockResolvedValue(false),
  requestAccess: vi.fn(),
  getAddress: vi.fn(),
  signTransaction: vi.fn(),
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
// Helpers
// ---------------------------------------------------------------------------

function Harness({ onRender }: { onRender: (w: ReturnType<typeof useWallet>) => void }) {
  const wallet = useWallet()
  onRender(wallet)
  return null
}

function renderProvider(
  queryClient: QueryClient,
  onRender: (w: ReturnType<typeof useWallet>) => void,
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <Harness onRender={onRender} />
      </WalletProvider>
    </QueryClientProvider>,
  )
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletProvider — Freighter account switch (issue #59)', () => {
  beforeEach(() => {
    watchCallback = null
    mockWatcherStop.mockClear()
    vi.mocked(freighter.WatchWalletChanges).mockClear()
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: false } as never)
  })

  afterEach(() => vi.clearAllMocks())

  it('updates the displayed address when Freighter reports a different account', async () => {
    // Simulate a pre-authorized session with account A.
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'ACCOUNT_A' } as never)

    const qc = makeQueryClient()
    let latest: ReturnType<typeof useWallet> | undefined
    renderProvider(qc, (w) => {
      latest = w
    })

    // Wait for the restore effect to populate address A.
    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_A'))

    // The watcher should now be running.
    expect(freighter.WatchWalletChanges).toHaveBeenCalled()
    expect(watchCallback).not.toBeNull()

    // Simulate the user switching to account B inside Freighter.
    act(() => {
      watchCallback!({
        address: 'ACCOUNT_B',
        network: 'TESTNET',
        networkPassphrase: 'Test SDF Network ; September 2015',
      })
    })

    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_B'))
  })

  it('invalidates wallet-scoped query caches on account switch', async () => {
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'ACCOUNT_A' } as never)

    const qc = makeQueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    let latest: ReturnType<typeof useWallet> | undefined
    renderProvider(qc, (w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_A'))
    invalidate.mockClear() // clear any calls made during restore

    act(() => {
      watchCallback!({ address: 'ACCOUNT_B', network: 'TESTNET', networkPassphrase: '' })
    })

    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_B'))

    // userData, userLoans, and stake caches must all be invalidated.
    const invalidatedKeys = invalidate.mock.calls.map(
      (c) => (c[0] as { queryKey: unknown[] }).queryKey[0],
    )
    expect(invalidatedKeys).toContain('userData')
    expect(invalidatedKeys).toContain('userLoans')
    expect(invalidatedKeys).toContain('stake')
  })

  it('does not re-render or invalidate when the same address is reported again', async () => {
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'ACCOUNT_A' } as never)

    const qc = makeQueryClient()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')

    let latest: ReturnType<typeof useWallet> | undefined
    renderProvider(qc, (w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_A'))
    invalidate.mockClear()

    // Watcher fires with the same address — should be a no-op.
    act(() => {
      watchCallback!({ address: 'ACCOUNT_A', network: 'TESTNET', networkPassphrase: '' })
    })

    // Give React a tick to process any potential state updates.
    await new Promise((r) => setTimeout(r, 10))

    expect(invalidate).not.toHaveBeenCalled()
    expect(latest?.address).toBe('ACCOUNT_A')
  })

  it('does not start the watcher when Freighter is not installed (address remains null)', async () => {
    // isAllowed rejects — simulates extension absent.
    vi.mocked(freighter.isAllowed).mockRejectedValue(new Error('not installed'))

    const qc = makeQueryClient()
    let latest: ReturnType<typeof useWallet> | undefined
    renderProvider(qc, (w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.address).toBeNull())

    // Watcher constructor must never have been called (no address to watch).
    expect(freighter.WatchWalletChanges).not.toHaveBeenCalled()
  })

  it('stops the watcher when the wallet is disconnected', async () => {
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'ACCOUNT_A' } as never)

    const qc = makeQueryClient()
    let latest: ReturnType<typeof useWallet> | undefined
    renderProvider(qc, (w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_A'))
    expect(freighter.WatchWalletChanges).toHaveBeenCalled()

    act(() => {
      latest!.disconnect()
    })

    await waitFor(() => expect(latest?.address).toBeNull())
    expect(mockWatcherStop).toHaveBeenCalled()
  })
})

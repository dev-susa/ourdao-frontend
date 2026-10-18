// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useUserData } from '@/hooks/useDAO'
import type { UserData } from '@/types/dao'

// #69: useUserData previously collapsed "membership not yet known" (query
// still in flight) and "confirmed not a member" into the same isMember:
// false — these tests assert isLoading actually distinguishes the two.
// #307 adds the *wallet* half of the same problem: during a hard refresh the
// address hasn't arrived, so the query is disabled (isLoading false) and
// isMember is false for a wallet that is in fact a member.

let resolveIsMember: (v: boolean) => void = () => {}

// Mutable so a test can put the wallet back into its pre-restore state: this
// is the window where `isConnected` is false but the wallet is connected.
let mockWallet: { address: string | null; isConnected: boolean; isRestoring: boolean } = {
  address: 'GALICE',
  isConnected: true,
  isRestoring: false,
}

vi.mock('@/lib/wallet', () => ({
  useWallet: () => mockWallet,
}))

vi.mock('@/lib/stellar', () => ({
  isContractConfigured: () => true,
  CONTRACT_ID: 'CTEST',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}))

vi.mock('@/lib/dao-client', () => ({
  daoRead: {
    isMember: () =>
      new Promise<boolean>((resolve) => {
        resolveIsMember = resolve
      }),
    isAdmin: () => Promise.resolve(false),
    getMember: () => Promise.resolve(null),
    getPendingYield: () => Promise.resolve(0),
  },
  daoWrite: () => ({}),
}))

vi.mock('@/lib/backend', () => ({
  backend: {
    getLoans: () => Promise.resolve([]),
  },
}))

function Harness({ onRender }: { onRender: (data: UserData) => void }) {
  const data = useUserData()
  onRender(data)
  return null
}

function renderWithClient(onRender: (data: UserData) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Harness onRender={onRender} />
    </QueryClientProvider>
  )
}

describe('useUserData isLoading', () => {
  beforeEach(() => {
    resolveIsMember = () => {}
    mockWallet = { address: 'GALICE', isConnected: true, isRestoring: false }
  })
  afterEach(() => vi.clearAllMocks())

  it('reports isLoading: true and isMember: false while the read is in flight — not yet a real "non-member" answer', async () => {
    let latest: UserData | undefined
    renderWithClient((d) => {
      latest = d
    })

    await waitFor(() => expect(latest?.isLoading).toBe(true))
    expect(latest?.isMember).toBe(false)
  })

  it('settles to isLoading: false once the read resolves, with isMember reflecting the real value', async () => {
    let latest: UserData | undefined
    renderWithClient((d) => {
      latest = d
    })

    await waitFor(() => expect(latest?.isLoading).toBe(true))
    resolveIsMember(true)

    await waitFor(() => expect(latest?.isLoading).toBe(false))
    expect(latest?.isMember).toBe(true)
  })

  // #307 — the regression that motivated folding isRestoring into isLoading.
  describe('while the wallet is still restoring (hard refresh)', () => {
    it('reports isLoading: true even though the query is disabled and settled', async () => {
      // No address yet ⇒ the query can't run ⇒ TanStack reports isLoading
      // false and isMember false. Reading either as a verdict is what bounced
      // connected members to /register on every hard refresh.
      mockWallet = { address: null, isConnected: false, isRestoring: true }
      let latest: UserData | undefined
      renderWithClient((d) => {
        latest = d
      })

      await waitFor(() => expect(latest?.isLoading).toBe(true))
      expect(latest?.isMember).toBe(false)
      expect(latest?.isConnected).toBe(false)
    })

    it('stays isLoading: true until the address arrives and the read completes', async () => {
      mockWallet = { address: null, isConnected: false, isRestoring: true }
      let latest: UserData | undefined
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { rerender } = render(
        <QueryClientProvider client={client}>
          <Harness onRender={(d) => { latest = d }} />
        </QueryClientProvider>
      )
      await waitFor(() => expect(latest?.isLoading).toBe(true))

      // Freighter answers: here is the address, restore is over.
      mockWallet = { address: 'GALICE', isConnected: true, isRestoring: false }
      rerender(
        <QueryClientProvider client={client}>
          <Harness onRender={(d) => { latest = d }} />
        </QueryClientProvider>
      )

      // The read is now genuinely in flight — still not a verdict.
      await waitFor(() => expect(latest?.isLoading).toBe(true))

      resolveIsMember(true)
      await waitFor(() => expect(latest?.isLoading).toBe(false))
      expect(latest?.isMember).toBe(true)
    })

    it('does not report isLoading forever once the wallet reports in', async () => {
      mockWallet = { address: null, isConnected: false, isRestoring: true }
      let latest: UserData | undefined
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { rerender } = render(
        <QueryClientProvider client={client}>
          <Harness onRender={(d) => { latest = d }} />
        </QueryClientProvider>
      )
      await waitFor(() => expect(latest?.isLoading).toBe(true))

      mockWallet = { address: 'GALICE', isConnected: true, isRestoring: false }
      rerender(
        <QueryClientProvider client={client}>
          <Harness onRender={(d) => { latest = d }} />
        </QueryClientProvider>
      )
      resolveIsMember(false)

      await waitFor(() => expect(latest?.isLoading).toBe(false))
      // Now, and only now, isMember: false is a real answer.
      expect(latest?.isMember).toBe(false)
    })
  })
})

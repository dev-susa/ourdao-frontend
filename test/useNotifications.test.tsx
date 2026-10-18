// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAutoNotifications, useActivityFeed } from '@/hooks/useNotifications'
import type { BackendEvent, BackendNotification, MutationResult } from '@/lib/backend'

const mockGetNotifications = vi.fn()
const mockMarkNotificationRead = vi.fn()
const mockMarkAllNotificationsRead = vi.fn()
const mockGetEvents = vi.fn()
const mockSignMessage = vi.fn()
const mockToastError = vi.fn()

// The connected address is a mutable binding so a test can simulate a wallet
// switch and assert read state does not follow it across accounts (#306).
let mockAddress: string | null = 'GALICE'

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({ address: mockAddress, isConnected: !!mockAddress, signMessage: mockSignMessage }),
}))

vi.mock('@/lib/backend', () => ({
  backend: {
    getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
    markNotificationRead: (...args: unknown[]) => mockMarkNotificationRead(...args),
    markAllNotificationsRead: (...args: unknown[]) => mockMarkAllNotificationsRead(...args),
    getEvents: (...args: unknown[]) => mockGetEvents(...args),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => mockToastError(...args) },
}))

function Harness({ onRender }: { onRender: (hook: ReturnType<typeof useAutoNotifications>) => void }) {
  const hook = useAutoNotifications()
  onRender(hook)
  return null
}

function renderWithClient(onRender: (hook: ReturnType<typeof useAutoNotifications>) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Harness onRender={onRender} />
    </QueryClientProvider>
  )
}

const notif = (over: Partial<BackendNotification> = {}): BackendNotification => ({
  id: 1,
  address: 'GALICE',
  type: 'info',
  title: 'Hi',
  message: 'msg',
  ledger: 1,
  tx_hash: null,
  read: false,
  created_at: new Date().toISOString(),
  ...over,
})

const ok: MutationResult = { ok: true, status: 200 }
const fail = (message: string, reason: 'unauthorized' | 'rejected' | 'unavailable' = 'unauthorized'): MutationResult => ({
  ok: false,
  status: 401,
  reason,
  message,
})

describe('useAutoNotifications', () => {
  beforeEach(() => {
    mockAddress = 'GALICE'
    mockGetNotifications.mockReset().mockResolvedValue([])
    mockMarkNotificationRead.mockReset().mockResolvedValue(ok)
    mockMarkAllNotificationsRead.mockReset().mockResolvedValue(ok)
    mockSignMessage.mockReset().mockResolvedValue('c2ln')
    mockToastError.mockReset()
  })
  afterEach(() => vi.clearAllMocks())

  it('maps backend notifications and computes unreadCount', async () => {
    mockGetNotifications.mockResolvedValue([notif({ id: 1, read: false }), notif({ id: 2, read: true })])
    let latest: ReturnType<typeof useAutoNotifications> | undefined
    renderWithClient((hook) => { latest = hook })

    await waitFor(() => expect(latest?.notifications).toHaveLength(2))
    expect(latest?.unreadCount).toBe(1)
  })

  it('markAsRead optimistically flips read locally and persists via the backend', async () => {
    mockGetNotifications.mockResolvedValue([notif({ id: 5, read: false })])
    let latest: ReturnType<typeof useAutoNotifications> | undefined
    renderWithClient((hook) => { latest = hook })
    await waitFor(() => expect(latest?.notifications).toHaveLength(1))

    await act(async () => {
      await latest!.markAsRead('5')
    })

    await waitFor(() => expect(mockMarkNotificationRead).toHaveBeenCalledWith(5, expect.objectContaining({ address: 'GALICE' })))
  })

  it('markAllAsRead calls the backend with the connected address', async () => {
    mockGetNotifications.mockResolvedValue([notif({ id: 1 }), notif({ id: 2 })])
    let latest: ReturnType<typeof useAutoNotifications> | undefined
    renderWithClient((hook) => { latest = hook })
    await waitFor(() => expect(latest?.notifications).toHaveLength(2))

    await act(async () => {
      await latest!.markAllAsRead()
    })

    await waitFor(() => expect(mockMarkAllNotificationsRead).toHaveBeenCalledWith('GALICE', expect.objectContaining({ address: 'GALICE' })))
  })

  it('removeNotification filters the notification out client-side', async () => {
    mockGetNotifications.mockResolvedValue([notif({ id: 1 }), notif({ id: 2 })])
    let latest: ReturnType<typeof useAutoNotifications> | undefined
    renderWithClient((hook) => { latest = hook })
    await waitFor(() => expect(latest?.notifications).toHaveLength(2))

    act(() => {
      latest!.removeNotification('1')
    })

    await waitFor(() => expect(latest?.notifications.map((n) => n.id)).toEqual(['2']))
  })

  describe('a write that does not land (#306)', () => {
    // The old code flipped read state locally and never checked the result, so
    // a 401 looked like success until the next reload put every notification
    // back to unread.
    it('rolls the optimistic read state back and reports a 401', async () => {
      mockGetNotifications.mockResolvedValue([notif({ id: 5, read: false })])
      mockMarkNotificationRead.mockResolvedValue(fail('Invalid or expired nonce'))
      let latest: ReturnType<typeof useAutoNotifications> | undefined
      renderWithClient((hook) => { latest = hook })
      await waitFor(() => expect(latest?.notifications).toHaveLength(1))

      await act(async () => {
        await latest!.markAsRead('5')
      })

      await waitFor(() => expect(latest?.notifications[0].read).toBe(false))
      expect(latest?.unreadCount).toBe(1)
      expect(mockToastError).toHaveBeenCalledWith('Invalid or expired nonce')
    })

    it('rolls back a rejected signature prompt rather than showing a silent success', async () => {
      mockGetNotifications.mockResolvedValue([notif({ id: 7, read: false })])
      mockMarkNotificationRead.mockResolvedValue(fail('Signature rejected', 'rejected'))
      let latest: ReturnType<typeof useAutoNotifications> | undefined
      renderWithClient((hook) => { latest = hook })
      await waitFor(() => expect(latest?.notifications).toHaveLength(1))

      await act(async () => {
        await latest!.markAsRead('7')
      })

      await waitFor(() => expect(latest?.notifications[0].read).toBe(false))
      expect(mockToastError).toHaveBeenCalledWith('Signature rejected')
    })

    it('rolls back every optimistic read when mark-all is rejected', async () => {
      mockGetNotifications.mockResolvedValue([notif({ id: 1 }), notif({ id: 2 }), notif({ id: 3 })])
      mockMarkAllNotificationsRead.mockResolvedValue(fail('Unauthorized', 'unauthorized'))
      let latest: ReturnType<typeof useAutoNotifications> | undefined
      renderWithClient((hook) => { latest = hook })
      await waitFor(() => expect(latest?.unreadCount).toBe(3))

      await act(async () => {
        await latest!.markAllAsRead()
      })

      await waitFor(() => expect(latest?.unreadCount).toBe(3))
      expect(mockToastError).toHaveBeenCalledWith('Unauthorized')
    })

    it('does not report a failure when the write succeeds', async () => {
      mockGetNotifications.mockResolvedValue([notif({ id: 5, read: false })])
      let latest: ReturnType<typeof useAutoNotifications> | undefined
      renderWithClient((hook) => { latest = hook })
      await waitFor(() => expect(latest?.notifications).toHaveLength(1))

      await act(async () => {
        await latest!.markAsRead('5')
      })

      await waitFor(() => expect(latest?.notifications[0].read).toBe(true))
      expect(mockToastError).not.toHaveBeenCalled()
    })
  })

  describe('state is scoped to the address that owns it (#306)', () => {
    it('does not carry read state to a different wallet', async () => {
      mockGetNotifications.mockImplementation(async (address: string) =>
        address === 'GALICE' ? [notif({ id: 1, address: 'GALICE' })] : [notif({ id: 1, address: 'GBOB', read: false })]
      )
      let latest: ReturnType<typeof useAutoNotifications> | undefined
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const { rerender } = render(
        <QueryClientProvider client={client}>
          <Harness onRender={(hook) => { latest = hook }} />
        </QueryClientProvider>
      )
      await waitFor(() => expect(latest?.unreadCount).toBe(1))

      await act(async () => {
        await latest!.markAsRead('1')
      })
      await waitFor(() => expect(latest?.unreadCount).toBe(0))

      // Switch accounts: the new address's notification is unread on the
      // backend too, and must not inherit GALICE's optimistic read.
      await act(async () => {
        mockAddress = 'GBOB'
        rerender(
          <QueryClientProvider client={client}>
            <Harness onRender={(hook) => { latest = hook }} />
          </QueryClientProvider>
        )
      })

      await waitFor(() => expect(latest?.unreadCount).toBe(1))
      expect(latest?.notifications[0].read).toBe(false)
    })

    it('restores the previous wallet\'s own read state when switching back', async () => {
      mockGetNotifications.mockImplementation(async (address: string) => [notif({ id: 1, address })])
      let latest: ReturnType<typeof useAutoNotifications> | undefined
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const tree = () => (
        <QueryClientProvider client={client}>
          <Harness onRender={(hook) => { latest = hook }} />
        </QueryClientProvider>
      )
      mockAddress = 'GALICE'
      const { rerender } = render(tree())
      await waitFor(() => expect(latest?.unreadCount).toBe(1))

      await act(async () => {
        await latest!.markAsRead('1')
      })
      await waitFor(() => expect(latest?.unreadCount).toBe(0))

      await act(async () => {
        mockAddress = 'GBOB'
        rerender(tree())
      })
      await waitFor(() => expect(latest?.unreadCount).toBe(1))

      await act(async () => {
        mockAddress = 'GALICE'
        rerender(tree())
      })
      await waitFor(() => expect(latest?.unreadCount).toBe(0))
    })

    it('does nothing at all when no wallet is connected', async () => {
      mockAddress = null
      let latest: ReturnType<typeof useAutoNotifications> | undefined
      renderWithClient((hook) => { latest = hook })

      await act(async () => {
        await latest!.markAsRead('1')
        await latest!.markAllAsRead()
      })

      expect(mockMarkNotificationRead).not.toHaveBeenCalled()
      expect(mockMarkAllNotificationsRead).not.toHaveBeenCalled()
    })
  })
})

function ActivityHarness({ onRender }: { onRender: (r: ReturnType<typeof useActivityFeed>) => void }) {
  const result = useActivityFeed(10)
  onRender(result)
  return null
}

const event = (over: Partial<BackendEvent> = {}): BackendEvent => ({
  id: '1-0',
  ledger: 1,
  closed_at: new Date().toISOString(),
  contract_id: 'C1',
  symbol: 'joined',
  topics: [],
  data: [],
  tx_hash: null,
  created_at: new Date().toISOString(),
  ...over,
})

describe('useActivityFeed', () => {
  beforeEach(() => {
    mockGetEvents.mockReset()
  })

  it('maps a known symbol to its activity metadata', async () => {
    mockGetEvents.mockResolvedValue([event({ symbol: 'loan_appr' })])
    let latest: ReturnType<typeof useActivityFeed> | undefined
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ActivityHarness onRender={(r) => { latest = r }} />
      </QueryClientProvider>
    )

    await waitFor(() => expect(latest?.activities).toHaveLength(1))
    expect(latest?.activities[0]).toMatchObject({ type: 'loan', title: 'Loan approved' })
  })

  it.each([
    ['loan_rej', 'loan', 'Loan rejected'],
    ['loan_wait', 'loan', 'Loan awaiting funds'],
    ['tre_rej', 'treasury', 'Treasury proposal rejected'],
    ['tre_wait', 'treasury', 'Treasury withdrawal awaiting funds'],
  ])('surfaces the failure event %s as a distinct activity', async (symbol, type, title) => {
    mockGetEvents.mockResolvedValue([event({ symbol })])
    let latest: ReturnType<typeof useActivityFeed> | undefined
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ActivityHarness onRender={(r) => { latest = r }} />
      </QueryClientProvider>
    )

    await waitFor(() => expect(latest?.activities).toHaveLength(1))
    expect(latest?.activities[0]).toMatchObject({ type, title })
  })

  it('falls back to the raw symbol for an unrecognized event', async () => {
    mockGetEvents.mockResolvedValue([event({ symbol: 'some_future_event' })])
    let latest: ReturnType<typeof useActivityFeed> | undefined
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ActivityHarness onRender={(r) => { latest = r }} />
      </QueryClientProvider>
    )

    await waitFor(() => expect(latest?.activities).toHaveLength(1))
    expect(latest?.activities[0]).toMatchObject({ type: 'proposal', title: 'some_future_event' })
  })
})

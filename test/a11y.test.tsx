// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './test-utils'
import { AppShell } from '@/components/AppShell'
import { ConnectButton } from '@/components/ConnectButton'
import { runAxe, runAxeWithAllowlist, KNOWN_A11Y_ALLOWLIST, formatViolations, assertInteractiveNames } from './a11y'

/**
 * Issue #238 — interactive components must have automated accessibility
 * assertions. axe-core runs on the real rendered output; direct role/name
 * assertions cover what axe cannot (skip-link target, dialog naming).
 *
 * A new violation fails the suite — no baseline snapshot to update.
 * See docs/a11y-audit.md for the triaged findings.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

vi.mock('@/hooks/useDAO', () => ({
  useUserData: () => ({ isAdmin: false }),
  useDAOStats: () => ({ indexerStale: false }),
}))

vi.mock('@/lib/stellar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar')>('@/lib/stellar')
  return { ...actual, isContractConfigured: () => true }
})

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: null,
    isConnected: false,
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signXDR: vi.fn(),
    networkMismatch: false,
    walletNetwork: null,
    freighterVersion: null,
    isVersionSupported: true,
  }),
}))

vi.mock('@/lib/backend', () => ({
  backend: {
    getLoans: vi.fn().mockResolvedValue([]),
    getNotifications: vi.fn().mockResolvedValue([]),
    getEvents: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue(null),
    getAdminLog: vi.fn().mockResolvedValue([]),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}))

vi.mock('@/lib/dao-client', () => ({
  daoRead: {
    isMember: vi.fn().mockResolvedValue(false),
    isAdmin: vi.fn().mockResolvedValue(false),
    getMember: vi.fn().mockResolvedValue(null),
    getPendingYield: vi.fn().mockResolvedValue(BigInt(0)),
  },
  daoWrite: () => ({}),
}))

vi.mock('@/hooks/useNotifications', () => ({
  useAutoNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    removeNotification: vi.fn(),
    clearAllNotifications: vi.fn(),
    requestPermission: vi.fn(),
    enableAutoNotifications: vi.fn(),
    disableAutoNotifications: vi.fn(),
    autoNotifyEnabled: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    isListening: false,
  }),
  useActivityFeed: () => ({ activities: [] }),
}))

vi.mock('@/lib/pushNotifications', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/pushNotifications')>('@/lib/pushNotifications')
  return {
    ...actual,
    usePushNotifications: () => ({ supported: false, permission: 'default' }),
  }
})

vi.mock('@/lib/responsive', async () => {
  const actual = await vi.importActual<typeof import('@/lib/responsive')>('@/lib/responsive')
  return { ...actual, useIsMobile: () => false }
})

describe('issue #238 — automated accessibility assertions', () => {
  afterEach(() => vi.clearAllMocks())

  it('AppShell exposes a skip link, nav landmarks, and has no axe violations', async () => {
    const { container } = renderWithProviders(<AppShell>Page content</AppShell>)

    const skipLink = screen.getByRole('link', { name: /skip to main content/i })
    expect(skipLink).toHaveAttribute('href', '#main-content')
    expect(container.querySelector('#main-content')).not.toBeNull()

    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()

    assertInteractiveNames(container)

    const violations = await runAxe(container)
    expect(`${formatViolations(violations)}`).toBe('')
    expect(violations).toEqual([])
  })

  it('mobile drawer dialog carries an accessible name when opened', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppShell>Page content</AppShell>)

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const dialog = await screen.findByRole('dialog', { name: 'Navigation menu' })
    expect(dialog).toBeInTheDocument()
  })

  it('ConnectButton has an accessible name in both states and no axe violations', async () => {
    const { container } = render(<ConnectButton />)
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeInTheDocument()

    assertInteractiveNames(container)

    const violations = await runAxe(container)
    expect(violations).toEqual([])
  })

  it('notification bell exposes an accessible name (not title-only)', () => {
    renderWithProviders(<AppShell>Page content</AppShell>)
    // The pre-fix bell had title="Notifications" with no aria-label.
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument()
  })

  describe('issue #375 — accessibility allow-list and main pages at rest', () => {
    it('documents the allow-list with each entry linking a valid issue URL', () => {
      expect(KNOWN_A11Y_ALLOWLIST.length).toBeGreaterThan(0)
      for (const entry of KNOWN_A11Y_ALLOWLIST) {
        expect(entry.ruleId).toBeTruthy()
        expect(entry.issue).toMatch(/^https:\/\/github\.com\/ourdao\/ourdao-frontend\/issues\/\d+$/)
        expect(entry.reason).toBeTruthy()
      }
    })

    it('AppShell and main page layout at rest have no unallowlisted axe violations', async () => {
      const { container } = renderWithProviders(
        <AppShell>
          <header>
            <h1>Dashboard</h1>
          </header>
          <main>
            <section aria-labelledby="metrics-heading">
              <h2 id="metrics-heading">Overview Metrics</h2>
              <p>Active Members: 10</p>
            </section>
          </main>
        </AppShell>
      )

      const violations = await runAxeWithAllowlist(container)
      expect(formatViolations(violations)).toBe('')
      expect(violations).toEqual([])
    })

    it('Form controls at rest have no unallowlisted axe violations', async () => {
      const { container } = renderWithProviders(
        <AppShell>
          <form aria-label="Sample Loan Request Form">
            <div className="space-y-4">
              <label htmlFor="loan-amount" className="block text-sm font-medium">
                Loan Amount (XLM)
              </label>
              <input
                id="loan-amount"
                type="number"
                name="amount"
                aria-describedby="loan-amount-desc"
                className="border p-2 rounded"
              />
              <p id="loan-amount-desc" className="text-xs text-muted-foreground">
                Minimum loan is 10 XLM
              </p>
              <button type="submit" className="btn btn-primary">
                Submit Request
              </button>
            </div>
          </form>
        </AppShell>
      )

      assertInteractiveNames(container)
      const violations = await runAxeWithAllowlist(container)
      expect(formatViolations(violations)).toBe('')
      expect(violations).toEqual([])
    })

    it('Governance page at rest inside AppShell has no unallowlisted axe violations', async () => {
      const { container } = renderWithProviders(
        <AppShell>
          <header>
            <h1>Governance Proposals</h1>
          </header>
          <main>
            <section aria-labelledby="proposals-heading">
              <h2 id="proposals-heading">Active Proposals</h2>
              <ul>
                <li className="flex items-center justify-between p-4">
                  <div>
                    <h3>Loan Proposal #1</h3>
                    <p>100 XLM · 5.0%</p>
                  </div>
                  <div role="group" aria-label="Vote options">
                    <button type="button" aria-label="Vote for proposal 1">
                      Vote For
                    </button>
                    <button type="button" aria-label="Vote against proposal 1">
                      Vote Against
                    </button>
                  </div>
                </li>
              </ul>
            </section>
          </main>
        </AppShell>
      )

      assertInteractiveNames(container)
      const violations = await runAxeWithAllowlist(container)
      expect(formatViolations(violations)).toBe('')
      expect(violations).toEqual([])
    })
  })
})


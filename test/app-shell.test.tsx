// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { renderWithProviders } from './test-utils'
import { AppShell } from '@/components/AppShell'

const mockIsMember = vi.fn()
const mockIsAdmin = vi.fn()
const mockGetMember = vi.fn()
const mockGetPendingYield = vi.fn()
const mockGetNotifications = vi.fn()
const mockGetEvents = vi.fn()
const mockGetStats = vi.fn()
const mockGetTotalMembers = vi.fn()
const mockGetActiveMembers = vi.fn()
const mockGetConsensusThreshold = vi.fn()
const mockGetTreasuryBalance = vi.fn()
const mockGetLoanPolicy = vi.fn()
const mockIsPaused = vi.fn()
let mockPathname: string | null = '/dashboard'
let mockWalletAddress: string | null = 'GALICE'
let mockIsConnected = true
let mockContractConfigured = true

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: mockWalletAddress,
    isConnected: mockIsConnected,
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signXDR: vi.fn(),
    networkMismatch: false,
    walletNetwork: mockIsConnected ? 'TESTNET' : null,
  }),
}))

vi.mock('@/lib/stellar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar')>('@/lib/stellar')
  return { ...actual, isContractConfigured: () => mockContractConfigured }
})

vi.mock('@/lib/dao-client', () => ({
  daoRead: {
    isMember: (...a: unknown[]) => mockIsMember(...a),
    isAdmin: (...a: unknown[]) => mockIsAdmin(...a),
    getMember: (...a: unknown[]) => mockGetMember(...a),
    getPendingYield: (...a: unknown[]) => mockGetPendingYield(...a),
    getTotalMembers: (...a: unknown[]) => mockGetTotalMembers(...a),
    getActiveMembers: (...a: unknown[]) => mockGetActiveMembers(...a),
    getConsensusThreshold: (...a: unknown[]) => mockGetConsensusThreshold(...a),
    getTreasuryBalance: (...a: unknown[]) => mockGetTreasuryBalance(...a),
    getLoanPolicy: (...a: unknown[]) => mockGetLoanPolicy(...a),
    isPaused: (...a: unknown[]) => mockIsPaused(...a),
  },
  daoWrite: () => ({}),
}))

vi.mock('@/lib/backend', () => ({
  isBackendConfigured: () => true,
  backend: {
    isConfigured: () => true,
    getLoans: vi.fn().mockResolvedValue([]),
    getNotifications: (...a: unknown[]) => mockGetNotifications(...a),
    getEvents: (...a: unknown[]) => mockGetEvents(...a),
    getStats: (...a: unknown[]) => mockGetStats(...a),
    getAdminLog: vi.fn().mockResolvedValue([]),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}))

describe('AppShell navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMember.mockResolvedValue(true)
    mockIsAdmin.mockResolvedValue(false)
    mockGetMember.mockResolvedValue(null)
    mockGetPendingYield.mockResolvedValue(BigInt(0))
    mockGetNotifications.mockResolvedValue([])
    mockGetEvents.mockResolvedValue([])
    mockGetStats.mockResolvedValue({ indexerStale: false, indexerError: false })
    mockGetTotalMembers.mockResolvedValue(1)
    mockGetActiveMembers.mockResolvedValue(1)
    mockGetConsensusThreshold.mockResolvedValue(5100)
    mockGetTreasuryBalance.mockResolvedValue(BigInt(0))
    mockGetLoanPolicy.mockResolvedValue({})
    mockIsPaused.mockResolvedValue(false)
    mockPathname = '/dashboard'
    mockWalletAddress = 'GALICE'
    mockIsConnected = true
    mockContractConfigured = true
  })
  afterEach(() => vi.clearAllMocks())

  it('renders the primary nav items and highlights the active route', async () => {
    renderWithProviders(<AppShell>content</AppShell>)

    expect(screen.getByRole('link', { name: /Dashboard/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Loans/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Governance/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Treasury/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Privacy/ })).toBeInTheDocument()
  })

  it('does not show the Admin nav item for a non-admin member', async () => {
    mockIsAdmin.mockResolvedValue(false)
    renderWithProviders(<AppShell>content</AppShell>)

    await waitFor(() => expect(screen.getByRole('link', { name: /Loans/ })).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /Admin/ })).not.toBeInTheDocument()
  })

  it('shows the Admin nav item once isAdmin resolves true', async () => {
    mockIsAdmin.mockResolvedValue(true)
    renderWithProviders(<AppShell>content</AppShell>)

    await waitFor(() => expect(screen.getByRole('link', { name: /Admin/ })).toBeInTheDocument())
  })

  it('shows the connected wallet address, not the connect button, when a wallet is connected', () => {
    mockWalletAddress = 'GALICEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
    mockIsConnected = true
    renderWithProviders(<AppShell>content</AppShell>)

    expect(screen.queryByRole('button', { name: /Connect Wallet/ })).not.toBeInTheDocument()
  })

  it('shows a Connect Wallet button when no wallet is connected', () => {
    mockWalletAddress = null
    mockIsConnected = false
    renderWithProviders(<AppShell>content</AppShell>)

    expect(screen.getByRole('button', { name: /Connect Wallet/ })).toBeInTheDocument()
  })

  it('does not show the "no contract configured" banner when a contract is configured', () => {
    renderWithProviders(<AppShell>content</AppShell>)
    expect(screen.queryByText(/No contract configured/)).not.toBeInTheDocument()
  })

  it('renders the network badge in the header when wallet is connected', () => {
    mockIsConnected = true
    renderWithProviders(<AppShell>content</AppShell>)
    expect(screen.getByText('Testnet')).toBeInTheDocument()
  })

  it('shows the running build version and commit so bug reports can name it (#250)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.1.0')
    vi.stubEnv('NEXT_PUBLIC_GIT_SHA', 'd44e397abcdef')
    renderWithProviders(<AppShell>content</AppShell>)
    expect(screen.getAllByText('v0.1.0 (d44e397)').length).toBeGreaterThan(0)
    vi.unstubAllEnvs()
  })

  it('does not render the network badge when wallet is not connected', () => {
    mockWalletAddress = null
    mockIsConnected = false
    renderWithProviders(<AppShell>content</AppShell>)
    // Badge should not be rendered; only Connect button should appear
    expect(screen.queryByText(/Testnet|Mainnet|Futurenet/)).not.toBeInTheDocument()
  })

  it('marks no route active when the pathname is not known yet', () => {
    mockPathname = null
    renderWithProviders(<AppShell>content</AppShell>)

    expect(screen.getByRole('link', { name: /Loans/ })).not.toHaveAttribute('aria-current')
  })

  it('moves focus to the new page and scrolls to the top on a client-side route change', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    // Rendered directly (not via renderWithProviders) so the providers can be
    // re-supplied on rerender — RTL's rerender replaces the whole root.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (heading: string) => (
      <QueryClientProvider client={client}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <AppShell>
            <h1>{heading}</h1>
          </AppShell>
        </ThemeProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(tree('Dashboard'))

    mockPathname = '/loans'
    rerender(tree('Loans'))

    expect(scrollTo).toHaveBeenCalledWith({ top: 0 })
    expect(document.getElementById('main-content')).toHaveAttribute('tabindex', '-1')
    scrollTo.mockRestore()
  })

  it('opens the mobile drawer and closes it when a nav item is chosen', async () => {
    renderWithProviders(<AppShell>content</AppShell>)

    fireEvent.click(screen.getByRole('button', { name: /Open navigation/ }))
    // The drawer is portalled after the desktop sidebar, so its link is last.
    const loansLinks = await screen.findAllByRole('link', { name: /^Loans$/ })
    fireEvent.click(loansLinks[loansLinks.length - 1])

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows the indexer-stale banner when the indexer reports stale data', async () => {
    mockGetStats.mockResolvedValue({
      indexerStale: true,
      secondsSinceUpdate: 120,
      lastIndexedLedger: 5,
    })
    renderWithProviders(<AppShell>content</AppShell>)

    expect(await screen.findByTestId('indexer-stale-banner')).toBeInTheDocument()
  })

  it('shows the backend-unreachable banner when the indexer read fails', async () => {
    mockGetStats.mockRejectedValue(new Error('indexer down'))
    renderWithProviders(<AppShell>content</AppShell>)

    expect(await screen.findByTestId('backend-unreachable-banner')).toBeInTheDocument()
  })

  it('shows the "no contract configured" banner in preview mode', () => {
    mockContractConfigured = false
    renderWithProviders(<AppShell>content</AppShell>)

    expect(screen.getByText(/No contract configured/)).toBeInTheDocument()
  })
})

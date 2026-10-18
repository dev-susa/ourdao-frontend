// @vitest-environment jsdom
// Covers the three degradation modes the README promises anyone deploying
// this app: no wallet connected, no NEXT_PUBLIC_CONTRACT_ID, and no reachable
// backend. Each should render an explicit, defined UI state — not throw, and
// not silently show fabricated/sample content in place of real data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import { AppShell } from '@/components/AppShell'
import DashboardPage from '@/app/(app)/dashboard/page'

const mockIsMember = vi.fn()
const mockIsAdmin = vi.fn()
const mockGetMember = vi.fn()
const mockGetPendingYield = vi.fn()
const mockGetTotalMembers = vi.fn()
const mockGetActiveMembers = vi.fn()
const mockGetConsensusThreshold = vi.fn()
const mockGetTreasuryBalance = vi.fn()
const mockGetLoanPolicy = vi.fn()
const mockIsPaused = vi.fn()
const mockGetEvents = vi.fn()
const mockGetStats = vi.fn()
const mockGetLoans = vi.fn()
const mockGetNotifications = vi.fn()

let mockWalletAddress: string | null = 'GALICE'
let mockIsConnected = true
let mockContractConfigured = true

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: mockWalletAddress,
    isConnected: mockIsConnected,
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signXDR: vi.fn(),
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
  daoWrite: () => ({ claimRewards: vi.fn() }),
}))

vi.mock('@/lib/backend', () => ({
  backend: {
    getLoans: (...a: unknown[]) => mockGetLoans(...a),
    getNotifications: (...a: unknown[]) => mockGetNotifications(...a),
    getEvents: (...a: unknown[]) => mockGetEvents(...a),
    getStats: (...a: unknown[]) => mockGetStats(...a),
    getAdminLog: vi.fn().mockResolvedValue([]),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}))

function resetDefaults() {
  vi.clearAllMocks()
  mockIsMember.mockResolvedValue(true)
  mockIsAdmin.mockResolvedValue(false)
  mockGetMember.mockResolvedValue({
    address: 'GALICE',
    status: 'ActiveMember',
    join_time: 0,
    contribution: BigInt(0),
    share_balance: BigInt(0),
    has_active_loan: false,
    last_loan_time: 0,
  })
  mockGetPendingYield.mockResolvedValue(BigInt(0))
  mockGetTotalMembers.mockResolvedValue(10)
  mockGetActiveMembers.mockResolvedValue(8)
  mockGetConsensusThreshold.mockResolvedValue(5000)
  mockGetTreasuryBalance.mockResolvedValue(BigInt(1_000_0000000))
  mockGetLoanPolicy.mockResolvedValue({})
  mockIsPaused.mockResolvedValue(false)
  mockGetEvents.mockResolvedValue([])
  mockGetStats.mockResolvedValue(null)
  mockGetLoans.mockResolvedValue([])
  mockGetNotifications.mockResolvedValue([])
  mockWalletAddress = 'GALICE'
  mockIsConnected = true
  mockContractConfigured = true
}

describe('degradation mode: no wallet connected', () => {
  beforeEach(resetDefaults)
  afterEach(() => vi.clearAllMocks())

  it('shows a connect prompt on /dashboard rather than a broken or empty dashboard', () => {
    mockWalletAddress = null
    mockIsConnected = false
    renderWithProviders(<DashboardPage />)

    expect(screen.getByText(/Access Dashboard/)).toBeInTheDocument()
    expect(screen.getByText(/Connect your wallet to access the member dashboard/)).toBeInTheDocument()
    // The populated-dashboard content must not be present at all.
    expect(screen.queryByText(/DAO Overview/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Quick Actions/)).not.toBeInTheDocument()
  })
})

describe('degradation mode: no NEXT_PUBLIC_CONTRACT_ID', () => {
  beforeEach(resetDefaults)
  afterEach(() => vi.clearAllMocks())

  it('AppShell renders the "not configured" banner instead of throwing', async () => {
    mockContractConfigured = false
    renderWithProviders(<AppShell>content</AppShell>)

    expect(await screen.findByText(/No contract configured/)).toBeInTheDocument()
    expect(screen.getByText(/NEXT_PUBLIC_CONTRACT_ID/)).toBeInTheDocument()
  })

  it('/dashboard with a connected wallet renders a defined state (not a crash) when contract reads are disabled', async () => {
    mockContractConfigured = false
    renderWithProviders(<DashboardPage />)

    // isMember's query is gated on isContractConfigured(), so it never
    // resolves true — the page must fall back to its "Not a Member" state
    // rather than rendering contract-dependent content or throwing.
    await waitFor(() => expect(screen.getByText(/Not a Member/)).toBeInTheDocument())
    expect(screen.queryByText(/DAO Overview/)).not.toBeInTheDocument()
  })
})

describe('degradation mode: backend unreachable', () => {
  beforeEach(resetDefaults)
  afterEach(() => vi.clearAllMocks())

  it('/dashboard shows "No recent activity" rather than an error or fabricated events', async () => {
    mockGetEvents.mockRejectedValue(new Error('fetch failed'))
    renderWithProviders(<DashboardPage />)

    await waitFor(() => expect(screen.getByText(/No recent activity/)).toBeInTheDocument())
    // Confirm no throw crashed the render — the member status card (which
    // only depends on direct contract reads, not the backend) is present.
    expect(screen.getByText(/Voting Weight/)).toBeInTheDocument()
  })

  it('does not fabricate placeholder event rows when the backend returns nothing', async () => {
    mockGetEvents.mockResolvedValue([])
    renderWithProviders(<DashboardPage />)

    await waitFor(() => expect(screen.getByText(/Recent Activity/)).toBeInTheDocument())
    expect(screen.getByText(/No recent activity/)).toBeInTheDocument()
    expect(screen.queryByText(/Loan approved/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Sample/i)).not.toBeInTheDocument()
  })
})

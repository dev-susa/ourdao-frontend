import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
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

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: 'GALICE',
    isConnected: true,
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signXDR: vi.fn(),
  }),
}))

vi.mock('@/lib/stellar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar')>('@/lib/stellar')
  return { ...actual, isContractConfigured: () => true }
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
  daoWrite: () => ({ claimRewards: vi.fn().mockResolvedValue({ hash: 'tx', returnValue: null }) }),
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

function member(overrides: Record<string, unknown> = {}) {
  return {
    address: 'GALICE',
    status: 'ActiveMember',
    join_ledger: 0,
    contribution: BigInt(0),
    share_balance: BigInt(5_000_0000000),
    has_active_loan: false,
    last_loan_time: 0,
    ...overrides,
  }
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMember.mockResolvedValue(true)
    mockIsAdmin.mockResolvedValue(false)
    mockGetMember.mockResolvedValue(member())
    mockGetPendingYield.mockResolvedValue(BigInt(0))
    mockGetTotalMembers.mockResolvedValue(42)
    mockGetActiveMembers.mockResolvedValue(30)
    mockGetConsensusThreshold.mockResolvedValue(5000)
    mockGetTreasuryBalance.mockResolvedValue(BigInt(9_000_0000000))
    mockGetLoanPolicy.mockResolvedValue({})
    mockIsPaused.mockResolvedValue(false)
    mockGetEvents.mockResolvedValue([])
    mockGetStats.mockResolvedValue(null)
    mockGetLoans.mockResolvedValue([])
    mockGetNotifications.mockResolvedValue([])
  })
  afterEach(() => vi.clearAllMocks())

  it('renders a defined fallback immediately, before the member query resolves (loading state)', () => {
    renderWithProviders(<DashboardPage />)
    // Never a blank page: either the populated dashboard or the interim
    // "Not a Member" fallback (isMember defaults to false while pending).
    expect(document.body.textContent).not.toBe('')
  })

  it('populated state: renders the real DAO stats once queries resolve', async () => {
    renderWithProviders(<DashboardPage />)

    await waitFor(() => expect(screen.getByText('Total Members')).toBeInTheDocument())
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('Quick Actions')).toBeInTheDocument()
  })

  it('does not show the Admin Panel quick action for a non-admin-status member', async () => {
    mockGetMember.mockResolvedValue(member({ status: 'ActiveMember' }))
    renderWithProviders(<DashboardPage />)

    await waitFor(() => expect(screen.getByText('Quick Actions')).toBeInTheDocument())
    expect(screen.queryByText('Admin Panel')).not.toBeInTheDocument()
  })

  it.each([
    ['ActiveMember', 'Status: Active Member'],
    ['Inactive', 'Status: Inactive Member'],
  ])('labels a %s member as "%s"', async (status, label) => {
    mockGetMember.mockResolvedValue(member({ status }))
    renderWithProviders(<DashboardPage />)

    await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument())
  })

  it('labels a missing member record as Non-Member rather than an unrelated status', async () => {
    mockGetMember.mockResolvedValue(null)
    renderWithProviders(<DashboardPage />)

    await waitFor(() => expect(screen.getByText('Quick Actions')).toBeInTheDocument())
    expect(screen.getByText('Status: Non-Member')).toBeInTheDocument()
  })

  it('empty state: hides the rewards section when there is nothing to claim', async () => {
    mockGetPendingYield.mockResolvedValue(BigInt(0))
    renderWithProviders(<DashboardPage />)

    await waitFor(() => expect(screen.getByText('Quick Actions')).toBeInTheDocument())
    expect(screen.queryByText('Available Rewards')).not.toBeInTheDocument()
  })

  it('populated state: shows the rewards section and lets the member claim', async () => {
    mockGetPendingYield.mockResolvedValue(BigInt(1_000_0000))
    renderWithProviders(<DashboardPage />)

    await waitFor(() => expect(screen.getByText('Available Rewards')).toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /Claim/ }).length).toBeGreaterThan(0)
  })
})

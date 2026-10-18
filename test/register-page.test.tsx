// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import RegisterPage from '@/app/register/page'

const mockIsMember = vi.fn()
const mockIsAdmin = vi.fn()
const mockGetMember = vi.fn()
const mockGetPendingYield = vi.fn()
const mockGetLoanPolicy = vi.fn()
const mockGetTotalMembers = vi.fn()
const mockGetActiveMembers = vi.fn()
const mockGetConsensusThreshold = vi.fn()
const mockGetTreasuryBalance = vi.fn()
const mockIsPaused = vi.fn()
const mockGetLoans = vi.fn()

let mockWalletAddress: string | null = 'GALICE'
let mockIsConnected = true

vi.mock('next/navigation', () => ({
  usePathname: () => '/register',
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
  return { ...actual, isContractConfigured: () => true }
})

vi.mock('@/lib/dao-client', () => ({
  daoRead: {
    isMember: (...a: unknown[]) => mockIsMember(...a),
    isAdmin: (...a: unknown[]) => mockIsAdmin(...a),
    getMember: (...a: unknown[]) => mockGetMember(...a),
    getPendingYield: (...a: unknown[]) => mockGetPendingYield(...a),
    getLoanPolicy: (...a: unknown[]) => mockGetLoanPolicy(...a),
    getTotalMembers: (...a: unknown[]) => mockGetTotalMembers(...a),
    getActiveMembers: (...a: unknown[]) => mockGetActiveMembers(...a),
    getConsensusThreshold: (...a: unknown[]) => mockGetConsensusThreshold(...a),
    getTreasuryBalance: (...a: unknown[]) => mockGetTreasuryBalance(...a),
    isPaused: (...a: unknown[]) => mockIsPaused(...a),
  },
  daoWrite: () => ({ registerMember: vi.fn() }),
}))

vi.mock('@/lib/backend', () => ({
  backend: {
    getLoans: (...a: unknown[]) => mockGetLoans(...a),
    getNotifications: vi.fn().mockResolvedValue([]),
    getEvents: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue(null),
    getAdminLog: vi.fn().mockResolvedValue([]),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}))

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMember.mockResolvedValue(false)
    mockIsAdmin.mockResolvedValue(false)
    mockGetMember.mockResolvedValue(null)
    mockGetPendingYield.mockResolvedValue(BigInt(0))
    mockGetLoanPolicy.mockResolvedValue({ membership_contribution: BigInt(100_0000000) })
    mockGetTotalMembers.mockResolvedValue(10)
    mockGetActiveMembers.mockResolvedValue(8)
    mockGetConsensusThreshold.mockResolvedValue(5000)
    mockGetTreasuryBalance.mockResolvedValue(BigInt(0))
    mockIsPaused.mockResolvedValue(false)
    mockGetLoans.mockResolvedValue([])
    mockWalletAddress = 'GALICE'
    mockIsConnected = true
  })
  afterEach(() => vi.clearAllMocks())

  it('shows a connect prompt when no wallet is connected', () => {
    mockWalletAddress = null
    mockIsConnected = false
    renderWithProviders(<RegisterPage />)

    expect(screen.getByText('Connect Your Wallet')).toBeInTheDocument()
  })

  it('shows the real membership fee (not a fabricated placeholder) for a connected non-member', async () => {
    renderWithProviders(<RegisterPage />)

    expect(screen.getAllByText('Membership Fee:').length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getAllByText('100').length).toBeGreaterThan(0))
  })
})

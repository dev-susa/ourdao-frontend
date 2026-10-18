// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import PrivacyPage from '@/app/(app)/privacy/page'

const mockIsMember = vi.fn()
const mockIsAdmin = vi.fn()
const mockGetMember = vi.fn()
const mockGetPendingYield = vi.fn()
const mockGetTreasuryProposal = vi.fn()
const mockGetLoans = vi.fn()
const mockGetStats = vi.fn()

let mockWalletAddress: string | null = 'GALICE'
let mockIsConnected = true

vi.mock('next/navigation', () => ({
  usePathname: () => '/privacy',
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
    getTreasuryProposal: (...a: unknown[]) => mockGetTreasuryProposal(...a),
  },
  daoWrite: () => ({}),
}))

vi.mock('@/lib/backend', () => ({
  backend: {
    getLoans: (...a: unknown[]) => mockGetLoans(...a),
    getNotifications: vi.fn().mockResolvedValue([]),
    getEvents: vi.fn().mockResolvedValue([]),
    getStats: (...a: unknown[]) => mockGetStats(...a),
    getAdminLog: vi.fn().mockResolvedValue([]),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}))

describe('PrivacyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMember.mockResolvedValue(true)
    mockIsAdmin.mockResolvedValue(false)
    mockGetMember.mockResolvedValue({ status: 'ActiveMember', has_active_loan: false })
    mockGetPendingYield.mockResolvedValue(BigInt(0))
    mockGetLoans.mockResolvedValue([])
    mockGetStats.mockResolvedValue({ totalTreasuryProposals: 0 })
    mockWalletAddress = 'GALICE'
    mockIsConnected = true
  })
  afterEach(() => vi.clearAllMocks())

  it('shows a connect prompt when no wallet is connected', () => {
    mockWalletAddress = null
    mockIsConnected = false
    renderWithProviders(<PrivacyPage />)

    expect(screen.getByText('Wallet Not Connected')).toBeInTheDocument()
  })

  it('renders for a connected member without throwing', async () => {
    renderWithProviders(<PrivacyPage />)
    await waitFor(() => expect(screen.queryByText('Wallet Not Connected')).not.toBeInTheDocument())
    expect(document.body.textContent).not.toBe('')
  })
})

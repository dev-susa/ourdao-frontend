// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import MembersPage from '@/app/(app)/members/page'
import type { BackendMember } from '@/lib/backend'

const mockGetMembers = vi.fn()
const mockGetStats = vi.fn()
const mockGetLoans = vi.fn()
const mockGetNotifications = vi.fn()
const mockGetEvents = vi.fn()
const mockGetAdminLog = vi.fn()
const mockIsMember = vi.fn()
const mockIsAdmin = vi.fn()
const mockGetMember = vi.fn()
const mockGetPendingYield = vi.fn()
const mockGetStake = vi.fn()
const mockCalculateExitShare = vi.fn()
const mockGetTotalMembers = vi.fn()
const mockGetActiveMembers = vi.fn()
const mockGetConsensusThreshold = vi.fn()
const mockGetTreasuryBalance = vi.fn()
const mockGetLoanPolicy = vi.fn()
const mockIsPaused = vi.fn()

let mockWalletAddress: string | null = 'GALICE'
let mockIsConnected = true

vi.mock('next/navigation', () => ({
  usePathname: () => '/members',
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
    getStake: (...a: unknown[]) => mockGetStake(...a),
    calculateExitShare: (...a: unknown[]) => mockCalculateExitShare(...a),
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
  backend: {
    isConfigured: () => true,
    getMembers: (...a: unknown[]) => mockGetMembers(...a),
    getStats: (...a: unknown[]) => mockGetStats(...a),
    getLoans: (...a: unknown[]) => mockGetLoans(...a),
    getNotifications: (...a: unknown[]) => mockGetNotifications(...a),
    getEvents: (...a: unknown[]) => mockGetEvents(...a),
    getAdminLog: (...a: unknown[]) => mockGetAdminLog(...a),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}))

function member(over: Partial<BackendMember> = {}): BackendMember {
  return {
    address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    joined_ledger: 1000,
    contribution: '0',
    exited: false,
    exit_share: null,
    exited_ledger: null,
    pending_claimed: '0',
    stake: '100000000',
    has_active_loan: false,
    name: null,
    defaults_count: 0,
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('MembersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWalletAddress = 'GALICE'
    mockIsConnected = true
    mockIsMember.mockResolvedValue(true)
    mockIsAdmin.mockResolvedValue(false)
    mockGetMember.mockResolvedValue({ status: 'ActiveMember', has_active_loan: false })
    mockGetPendingYield.mockResolvedValue(BigInt(0))
    mockGetStake.mockResolvedValue(BigInt(0))
    mockCalculateExitShare.mockResolvedValue(BigInt(0))
    mockGetTotalMembers.mockResolvedValue(1)
    mockGetActiveMembers.mockResolvedValue(1)
    mockGetConsensusThreshold.mockResolvedValue(5100)
    mockGetTreasuryBalance.mockResolvedValue(BigInt(0))
    mockGetLoanPolicy.mockResolvedValue({})
    mockIsPaused.mockResolvedValue(false)
    mockGetLoans.mockResolvedValue([])
    mockGetNotifications.mockResolvedValue([])
    mockGetEvents.mockResolvedValue([])
    mockGetAdminLog.mockResolvedValue([])
    mockGetStats.mockResolvedValue({ indexerStale: false, indexerError: false })
    mockGetMembers.mockResolvedValue([])
  })
  afterEach(() => vi.clearAllMocks())

  it('lists active members with their address, join ledger and stake', async () => {
    mockGetMembers.mockResolvedValue([
      member({ address: 'GAAA', name: 'Alice' }),
      member({ address: 'GBBB', has_active_loan: true }),
    ])

    renderWithProviders(<MembersPage />)

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.getByText('GAAA')).toBeInTheDocument()
    // A member with no registry name shows its (truncated) address as the title
    // as well as in full below it, hence the plural query.
    expect(screen.getAllByText(/GBBB/).length).toBeGreaterThan(0)
    expect(screen.getByText('Active loan')).toBeInTheDocument()
    // Both rows are joined at ledger 1000 and stake 10 tokens, so each value
    // appears once per member.
    expect(screen.getAllByText('#1000').length).toBe(2)
    expect(screen.getAllByText('10').length).toBe(2)
  })

  it('links each member to their profile', async () => {
    mockGetMembers.mockResolvedValue([member({ address: 'GAAA', name: 'Alice' })])

    renderWithProviders(<MembersPage />)

    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /Alice/ })).toHaveAttribute('href', '/members/GAAA')
  })

  it('shows an error state, not an empty list, when the backend fails (#230)', async () => {
    mockGetMembers.mockRejectedValue(new Error('indexer down'))

    renderWithProviders(<MembersPage />)

    expect(await screen.findByTestId('load-error')).toBeInTheDocument()
    expect(screen.queryByText('No members yet')).not.toBeInTheDocument()
  })

  it('shows an empty state when the DAO has no members', async () => {
    mockGetMembers.mockResolvedValue([])

    renderWithProviders(<MembersPage />)

    expect(await screen.findByText('No members yet')).toBeInTheDocument()
  })

  it('notes that membership is already public on-chain', async () => {
    renderWithProviders(<MembersPage />)
    expect(
      await screen.findByText(/already visible on-chain/i)
    ).toBeInTheDocument()
  })

  it('offers to show more members when the page is full', async () => {
    mockGetMembers.mockResolvedValue(Array.from({ length: 50 }, (_, i) => member({ address: `G${i}` })))

    renderWithProviders(<MembersPage />)

    expect(await screen.findByRole('button', { name: /show more members/i })).toBeInTheDocument()
  })
})

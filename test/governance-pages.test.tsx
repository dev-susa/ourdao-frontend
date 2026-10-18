// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import GovernancePage from '@/app/(app)/governance/page'
import CreateProposalPage from '@/app/(app)/governance/create/page'

const mockIsMember = vi.fn()
const mockIsAdmin = vi.fn()
const mockGetMember = vi.fn()
const mockGetPendingYield = vi.fn()
const mockGetLoanProposal = vi.fn()
const mockGetTreasuryProposal = vi.fn()
const mockGetTotalMembers = vi.fn()
const mockGetActiveMembers = vi.fn()
const mockGetConsensusThreshold = vi.fn()
const mockGetTreasuryBalance = vi.fn()
const mockGetLoanPolicy = vi.fn()
const mockIsPaused = vi.fn()
const mockGetLoans = vi.fn()
const mockGetNotifications = vi.fn()
const mockGetEvents = vi.fn()
const mockGetStats = vi.fn()
const mockProposeTreasuryWithdrawal = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/governance',
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
    getLoanProposal: (...a: unknown[]) => mockGetLoanProposal(...a),
    getTreasuryProposal: (...a: unknown[]) => mockGetTreasuryProposal(...a),
    getTotalMembers: (...a: unknown[]) => mockGetTotalMembers(...a),
    getActiveMembers: (...a: unknown[]) => mockGetActiveMembers(...a),
    getConsensusThreshold: (...a: unknown[]) => mockGetConsensusThreshold(...a),
    getTreasuryBalance: (...a: unknown[]) => mockGetTreasuryBalance(...a),
    getLoanPolicy: (...a: unknown[]) => mockGetLoanPolicy(...a),
    isPaused: (...a: unknown[]) => mockIsPaused(...a),
  },
  daoWrite: () => ({
    proposeTreasuryWithdrawal: (...a: unknown[]) => mockProposeTreasuryWithdrawal(...a),
  }),
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
  mockGetMember.mockResolvedValue({ status: 'ActiveMember', has_active_loan: false })
  mockGetPendingYield.mockResolvedValue(BigInt(0))
  mockGetTotalMembers.mockResolvedValue(10)
  mockGetActiveMembers.mockResolvedValue(8)
  mockGetConsensusThreshold.mockResolvedValue(5000)
  mockGetTreasuryBalance.mockResolvedValue(BigInt(0))
  mockGetLoanPolicy.mockResolvedValue({})
  mockIsPaused.mockResolvedValue(false)
  mockGetLoans.mockResolvedValue([])
  mockGetNotifications.mockResolvedValue([])
  mockGetEvents.mockResolvedValue([])
  mockGetStats.mockResolvedValue({ totalLoanProposals: 0, totalTreasuryProposals: 0 })
  mockProposeTreasuryWithdrawal.mockResolvedValue({ hash: 'tx', returnValue: null })
}

describe('GovernancePage', () => {
  beforeEach(resetDefaults)
  afterEach(() => vi.clearAllMocks())

  it('empty state: shows "No loan proposals yet" rather than fabricated rows', async () => {
    renderWithProviders(<GovernancePage />)
    await waitFor(() => expect(screen.getByText('No loan proposals yet.')).toBeInTheDocument())
  })

  it('populated state: renders a real loan proposal by id', async () => {
    mockGetStats.mockResolvedValue({ totalLoanProposals: 1, totalTreasuryProposals: 0 })
    mockGetLoanProposal.mockResolvedValue({
      id: 1,
      borrower: 'GBORROWER',
      amount: BigInt(1000_0000000),
      interest_rate: 500,
      status: 'Pending',
      phase: 'Voting',
      for_votes: 0,
      against_votes: 0,
      created_at: 1000,
      editing_period_end: 2000,
    })
    renderWithProviders(<GovernancePage />)

    await waitFor(() => expect(screen.getAllByText(/GBOR/).length).toBeGreaterThan(0))
    expect(screen.queryByText('No loan proposals yet.')).not.toBeInTheDocument()
  })
})

describe('CreateProposalPage', () => {
  beforeEach(resetDefaults)
  afterEach(() => vi.clearAllMocks())

  it('renders the treasury proposal form for a connected member', async () => {
    renderWithProviders(<CreateProposalPage />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Create Proposal' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Create Proposal/ })).toBeInTheDocument()
  })

  it('rejects a submission with an invalid destination address instead of calling the contract', async () => {
    renderWithProviders(<CreateProposalPage />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Create Proposal' })).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '100' } })
    fireEvent.change(screen.getByPlaceholderText('G… or C…'), { target: { value: 'not-a-valid-address' } })
    fireEvent.change(screen.getByPlaceholderText(/Explain what this withdrawal is for/), {
      target: { value: 'Pay a contractor' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Create Proposal/ }))

    expect(mockProposeTreasuryWithdrawal).not.toHaveBeenCalled()
  })
})

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import TreasuryProposalDetailPage from '@/app/(app)/treasury/[id]/page'

const mockGetTreasuryProposal = vi.fn()
const mockHasVoted = vi.fn()
const mockIsMember = vi.fn()
const mockVoteOnTreasury = vi.fn().mockResolvedValue({ hash: 'tx-vote-treasury', returnValue: null })

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '42' }),
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
    isAdmin: vi.fn().mockResolvedValue(false),
    getMember: vi.fn().mockResolvedValue(null),
    getPendingYield: vi.fn().mockResolvedValue(BigInt(0)),
    calculateExitShare: vi.fn().mockResolvedValue(null),
    getTreasuryProposal: (...a: unknown[]) => mockGetTreasuryProposal(...a),
    hasVoted: (...a: unknown[]) => mockHasVoted(...a),
    getDocument: vi.fn().mockResolvedValue(null),
    getTotalMembers: vi.fn().mockResolvedValue(10),
    getActiveMembers: vi.fn().mockResolvedValue(8),
    getConsensusThreshold: vi.fn().mockResolvedValue(5100),
    getTreasuryBalance: vi.fn().mockResolvedValue(BigInt(1000000000)),
    isPaused: vi.fn().mockResolvedValue(false),
  },
  daoWrite: () => ({
    voteOnTreasuryProposal: (...a: unknown[]) => mockVoteOnTreasury(...a),
  }),
  InvokeError: class InvokeError extends Error {
    retryable = false
    constructor(m: string) {
      super(m)
      this.name = 'InvokeError'
    }
  },
}))

describe('TreasuryProposalDetailPage (/treasury/[id])', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMember.mockResolvedValue(true)
    mockHasVoted.mockResolvedValue(false)
  })

  it('renders treasury proposal details when loaded', async () => {
    mockGetTreasuryProposal.mockResolvedValue({
      id: 42,
      destination: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      reason: 'Treasury Proposal #42',
      amount: '50000000',
      status: 2, // In Voting
      votesFor: '10',
      votesAgainst: '2',
      isPrivate: false,
    })

    renderWithProviders(<TreasuryProposalDetailPage />)

    await waitFor(() => {
      expect(screen.getAllByText(/Treasury Proposal #42/)[0]).toBeInTheDocument()
    })

    expect(screen.getByText('5')).toBeInTheDocument() // 50000000 stroops = 5 tokens
    expect(screen.getByText(/GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5/)).toBeInTheDocument()
    expect(screen.getByText('In Voting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vote For/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Vote Against/i })).toBeInTheDocument()
  })

  it('allows voting on an active proposal and calls voteOnTreasuryProposal', async () => {
    mockGetTreasuryProposal.mockResolvedValue({
      id: 42,
      destination: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      reason: 'Treasury Proposal #42',
      amount: '50000000',
      status: 2,
      votesFor: '10',
      votesAgainst: '2',
      isPrivate: false,
    })

    renderWithProviders(<TreasuryProposalDetailPage />)

    const voteForBtn = await screen.findByRole('button', { name: /Vote For/i })
    fireEvent.click(voteForBtn)

    await waitFor(() => {
      expect(mockVoteOnTreasury).toHaveBeenCalledWith(42, true)
    })
  })

  it('renders not found state when proposal read fails or returns null', async () => {
    mockGetTreasuryProposal.mockResolvedValue(null)

    renderWithProviders(<TreasuryProposalDetailPage />)

    await waitFor(() => {
      expect(screen.getByText(/Treasury Proposal Not Found/i)).toBeInTheDocument()
    })
  })
})

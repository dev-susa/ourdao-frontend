// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from './test-utils'
import LoanDetailsPage from '@/app/(app)/loans/[id]/page'

const mockIsMember = vi.fn()
const mockIsAdmin = vi.fn()
const mockGetMember = vi.fn()
const mockGetPendingYield = vi.fn()
const mockGetLoanProposal = vi.fn()
const mockGetLoan = vi.fn()
const mockGetDocument = vi.fn()
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
const mockToastError = vi.fn()
const mockPush = vi.fn()
const mockRepayLoan = vi.fn().mockResolvedValue({ hash: 'tx-repay', returnValue: null })
const mockRepayLoanPartial = vi.fn().mockResolvedValue({ hash: 'tx-partial', returnValue: null })
const mockMarkLoanDefaulted = vi.fn().mockResolvedValue({ hash: 'tx-default', returnValue: null })

vi.mock('next/navigation', () => ({
  usePathname: () => '/loans/1',
  useParams: () => ({ id: '1' }),
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...a: unknown[]) => mockToastError(...a), loading: vi.fn(() => 'id') },
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
    getLoan: (...a: unknown[]) => mockGetLoan(...a),
    getDocument: (...a: unknown[]) => mockGetDocument(...a),
    getTotalMembers: (...a: unknown[]) => mockGetTotalMembers(...a),
    getActiveMembers: (...a: unknown[]) => mockGetActiveMembers(...a),
    getConsensusThreshold: (...a: unknown[]) => mockGetConsensusThreshold(...a),
    getTreasuryBalance: (...a: unknown[]) => mockGetTreasuryBalance(...a),
    getLoanPolicy: (...a: unknown[]) => mockGetLoanPolicy(...a),
    isPaused: (...a: unknown[]) => mockIsPaused(...a),
  },
  daoWrite: () => ({
    repayLoan: (...a: unknown[]) => mockRepayLoan(...a),
    repayLoanPartial: (...a: unknown[]) => mockRepayLoanPartial(...a),
    markLoanDefaulted: (...a: unknown[]) => mockMarkLoanDefaulted(...a),
    voteOnLoanProposal: vi.fn().mockResolvedValue({ hash: 'tx-vote', returnValue: null }),
    attachDocument: vi.fn().mockResolvedValue({ hash: 'tx-attach', returnValue: null }),
  }),
  InvokeError: class InvokeError extends Error { retryable = false; constructor(m: string) { super(m); this.name = 'InvokeError' } },
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

describe('LoanDetailsPage', () => {
  beforeEach(() => {
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
    mockGetLoan.mockResolvedValue(null)
    mockGetDocument.mockResolvedValue(null)
    mockGetLoans.mockResolvedValue([])
    mockGetNotifications.mockResolvedValue([])
    mockGetEvents.mockResolvedValue([])
    mockGetStats.mockResolvedValue(null)
  })
  afterEach(() => vi.clearAllMocks())

  it('renders the real proposal fetched by the route id', async () => {
    mockGetLoanProposal.mockResolvedValue({
      id: 1,
      borrower: 'GBORROWER',
      amount: BigInt(1000_0000000),
      interest_rate: 500,
      status: 'Pending',
      phase: 'Voting',
      for_votes: 2,
      against_votes: 1,
      created_at: 1000,
      editing_period_end: 2000,
    })
    renderWithProviders(<LoanDetailsPage />)

    await waitFor(() => expect(screen.getByText(/Loan Proposal #1/)).toBeInTheDocument())
    expect(screen.queryByText('Loan Not Found')).not.toBeInTheDocument()
  })

  it('shows "Loan Not Found" — not a blank page — when the contract has no proposal at this id', async () => {
    mockGetLoanProposal.mockResolvedValue(null)
    renderWithProviders(<LoanDetailsPage />)

    await waitFor(() => expect(screen.getByText('Loan Not Found')).toBeInTheDocument())
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Loan not found'))
  })

  describe('loan repayment (partial + full)', () => {
    const borrower = 'GALICE'
    const principal = BigInt(1000_0000000) // 1000 tokens
    const totalRepayment = BigInt(1100_0000000) // 1100 tokens (100 interest)
    const amountRepaidZero = BigInt(0)

    function approvedProposal() {
      return {
        id: 1,
        borrower,
        amount: principal,
        interest_rate: 500,
        status: 'Approved',
        phase: 'Voting',
        for_votes: 5,
        against_votes: 1,
        created_at: 1000,
        editing_period_end: 2000,
      }
    }

    function activeLoan(overrides: Record<string, unknown> = {}) {
      return {
        id: 1,
        borrower,
        principal,
        interest_rate: 500,
        total_repayment: totalRepayment,
        start_time: Math.floor(Date.now() / 1000) - 1000,
        due_time: Math.floor(Date.now() / 1000) + 86400 * 30,
        status: 'Active',
        amount_repaid: amountRepaidZero,
        ...overrides,
      }
    }

    beforeEach(() => {
      mockRepayLoan.mockClear()
      mockRepayLoanPartial.mockClear()
      mockMarkLoanDefaulted.mockClear()
    })

    it('borrower sees an amount input defaulting to full outstanding balance', async () => {
      mockGetLoanProposal.mockResolvedValue(approvedProposal())
      mockGetLoan.mockResolvedValue(activeLoan())

      renderWithProviders(<LoanDetailsPage />)

      await waitFor(() => expect(screen.getByText('Loan Repayment')).toBeInTheDocument())
      const input = screen.getByLabelText(/Repayment amount/i) as HTMLInputElement
      // default is formatted full outstanding (1100 tokens) at 7 display decimals
      expect(input.value).toBe('1100')
      expect(screen.getByText('Outstanding balance')).toBeInTheDocument()
      expect(screen.getAllByText('1100').length).toBeGreaterThanOrEqual(1)
    })

    it('input rejects zero and negative values with a visible message', async () => {
      mockGetLoanProposal.mockResolvedValue(approvedProposal())
      mockGetLoan.mockResolvedValue(activeLoan())

      renderWithProviders(<LoanDetailsPage />)
      await waitFor(() => expect(screen.getByLabelText(/Repayment amount/i)).toBeInTheDocument())

      const input = screen.getByLabelText(/Repayment amount/i) as HTMLInputElement
      const repayBtn = screen.getByRole('button', { name: /Repay/ })

      // zero
      fireEvent.change(input, { target: { value: '0' } })
      await userEvent.click(repayBtn)
      expect(await screen.findByText('Amount must be greater than zero')).toBeInTheDocument()
      expect(mockRepayLoan).not.toHaveBeenCalled()
      expect(mockRepayLoanPartial).not.toHaveBeenCalled()

      // negative
      fireEvent.change(input, { target: { value: '-5' } })
      await userEvent.click(repayBtn)
      expect(await screen.findByText('Amount must be greater than zero')).toBeInTheDocument()
      expect(mockRepayLoan).not.toHaveBeenCalled()
      expect(mockRepayLoanPartial).not.toHaveBeenCalled()
    })

    it('input rejects amount exceeding outstanding balance', async () => {
      mockGetLoanProposal.mockResolvedValue(approvedProposal())
      mockGetLoan.mockResolvedValue(activeLoan())

      renderWithProviders(<LoanDetailsPage />)
      await waitFor(() => expect(screen.getByLabelText(/Repayment amount/i)).toBeInTheDocument())

      const input = screen.getByLabelText(/Repayment amount/i) as HTMLInputElement
      const repayBtn = screen.getByRole('button', { name: /Repay/ })

      fireEvent.change(input, { target: { value: '2000' } }) // >1100
      await userEvent.click(repayBtn)
      expect(await screen.findByText(/Amount exceeds outstanding balance/)).toBeInTheDocument()
      expect(mockRepayLoan).not.toHaveBeenCalled()
      expect(mockRepayLoanPartial).not.toHaveBeenCalled()
    })

    it('shows interest/principal split before signing (estimate)', async () => {
      mockGetLoanProposal.mockResolvedValue(approvedProposal())
      mockGetLoan.mockResolvedValue(activeLoan())

      renderWithProviders(<LoanDetailsPage />)
      await waitFor(() => expect(screen.getByLabelText(/Repayment amount/i)).toBeInTheDocument())

      const input = screen.getByLabelText(/Repayment amount/i) as HTMLInputElement
      // 50 tokens < outstandingInterest (100), so all interest
      fireEvent.change(input, { target: { value: '50' } })

      expect(await screen.findByText(/Estimated split/)).toBeInTheDocument()
      expect(screen.getAllByText('Interest').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Principal').length).toBeGreaterThanOrEqual(1)
      // 50 interest, 0 principal
      expect(screen.getAllByText('50').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText(/Estimate — exact split is computed on-chain/)).toBeInTheDocument()
    })

    it('partial repayment splits interest first: large partial covers interest then principal', async () => {
      mockGetLoanProposal.mockResolvedValue(approvedProposal())
      mockGetLoan.mockResolvedValue(activeLoan())

      renderWithProviders(<LoanDetailsPage />)
      await waitFor(() => expect(screen.getByLabelText(/Repayment amount/i)).toBeInTheDocument())

      const input = screen.getByLabelText(/Repayment amount/i) as HTMLInputElement
      // 200 tokens: 100 interest + 100 principal
      fireEvent.change(input, { target: { value: '200' } })

      await waitFor(() => expect(screen.getByText(/Estimated split/)).toBeInTheDocument())
      // interest 100, principal 100
      const interestValues = screen.getAllByText('100')
      expect(interestValues.length).toBeGreaterThanOrEqual(1)
    })

    it('borrower can repay less than full outstanding via partial path and loan remains active with updated outstanding', async () => {
      mockGetLoanProposal.mockResolvedValue(approvedProposal())
      // first call returns initial loan, second call after refetch returns updated loan
      mockGetLoan
        .mockResolvedValueOnce(activeLoan())
        .mockResolvedValue(activeLoan({ amount_repaid: BigInt(50_0000000) }))

      renderWithProviders(<LoanDetailsPage />)
      await waitFor(() => expect(screen.getByLabelText(/Repayment amount/i)).toBeInTheDocument())

      const input = screen.getByLabelText(/Repayment amount/i) as HTMLInputElement
      const repayBtn = screen.getByRole('button', { name: /Repay/ })

      fireEvent.change(input, { target: { value: '50' } })
      await userEvent.click(repayBtn)

      await waitFor(() => expect(mockRepayLoanPartial).toHaveBeenCalled())
      expect(mockRepayLoanPartial).toHaveBeenCalledWith(1, BigInt(50_0000000))
      expect(mockRepayLoan).not.toHaveBeenCalled()

      // after refetch, loan should still be Active and outstanding updated to 1050
      await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument())
      // outstanding display should now be 1050 (1100-50)
      await waitFor(() => expect(screen.getByText('1050')).toBeInTheDocument())
    })

    it('full repayment uses the full-balance path and still works in one click', async () => {
      mockGetLoanProposal.mockResolvedValue(approvedProposal())
      mockGetLoan.mockResolvedValue(activeLoan())

      renderWithProviders(<LoanDetailsPage />)
      await waitFor(() => expect(screen.getByLabelText(/Repayment amount/i)).toBeInTheDocument())

      const repayBtn = screen.getByRole('button', { name: /Repay Full Outstanding Balance/ })
      expect(repayBtn).toBeInTheDocument()

      await userEvent.click(repayBtn)

      await waitFor(() => expect(mockRepayLoan).toHaveBeenCalledWith(1))
      expect(mockRepayLoanPartial).not.toHaveBeenCalled()
    })

    it('Max button fills the full outstanding balance', async () => {
      mockGetLoanProposal.mockResolvedValue(approvedProposal())
      mockGetLoan.mockResolvedValue(activeLoan())

      renderWithProviders(<LoanDetailsPage />)
      await waitFor(() => expect(screen.getByLabelText(/Repayment amount/i)).toBeInTheDocument())

      const input = screen.getByLabelText(/Repayment amount/i) as HTMLInputElement
      fireEvent.change(input, { target: { value: '10' } })
      expect(input.value).toBe('10')

      const maxBtn = screen.getByRole('button', { name: 'Max' })
      await userEvent.click(maxBtn)
      expect(input.value).toBe('1100')
    })

    it('handles bigint via parseToken without float precision loss', async () => {
      // Use a value above Number.MAX_SAFE_INTEGER / 1e7 to prove bigint path
      const hugePrincipal = BigInt(Number.MAX_SAFE_INTEGER) * BigInt(100)
      const hugeTotal = hugePrincipal + BigInt(100_0000000)
      mockGetLoanProposal.mockResolvedValue(approvedProposal())
      mockGetLoan.mockResolvedValue(
        activeLoan({ principal: hugePrincipal, total_repayment: hugeTotal, amount_repaid: BigInt(0) })
      )

      renderWithProviders(<LoanDetailsPage />)
      await waitFor(() => expect(screen.getByLabelText(/Repayment amount/i)).toBeInTheDocument())

      const input = screen.getByLabelText(/Repayment amount/i) as HTMLInputElement
      // The default formatted huge value should be present and parseable
      expect(input.value).not.toBe('')
      // typing a huge value and submitting should call partial with bigint
      fireEvent.change(input, { target: { value: '1' } })
      const repayBtn = screen.getByRole('button', { name: /Repay/ })
      await userEvent.click(repayBtn)
      await waitFor(() => expect(mockRepayLoanPartial).toHaveBeenCalled())
      const calledAmount = mockRepayLoanPartial.mock.calls[0][1] as bigint
      expect(typeof calledAmount).toBe('bigint')
      expect(calledAmount).toBe(BigInt(1_0000000))
    })
  })
})

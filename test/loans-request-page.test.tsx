import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RequestLoanPage from '@/app/(app)/loans/request/page'

const mockPush = vi.fn()
const mockRequestLoan = vi.fn()
const mockAttach = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
let mockStats: Record<string, unknown> = { features: { documentStorage: true } }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    loading: () => 'toast-id',
  },
}))

vi.mock('@/components/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/hooks/useDAO', () => ({
  useDAOStats: () => mockStats,
  useUserData: () => ({
    isConnected: true,
    isMember: true,
    hasActiveLoan: false,
  }),
  useLoanRequest: () => ({
    requestLoan: (...args: unknown[]) => mockRequestLoan(...args),
    isPending: false,
    error: null,
    isSuccess: false,
  }),
  useAttachDocument: () => ({
    attach: (...args: unknown[]) => mockAttach(...args),
    isPending: false,
    error: null,
    isSuccess: false,
  }),
}))

async function fillAmountAndAdvance(amount = '10') {
  fireEvent.change(screen.getByLabelText(/Loan Amount/), { target: { value: amount } })
  fireEvent.click(screen.getByRole('button', { name: /Next/ }))
  await screen.findByText(/Supporting Documents/)
}

async function advanceToReview() {
  fireEvent.click(screen.getByRole('button', { name: /Next/ }))
  await screen.findByText(/Review & Submit/)
}

describe('RequestLoanPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStats = { features: { documentStorage: true } }
    mockRequestLoan.mockResolvedValue(42)
    mockAttach.mockResolvedValue({ hash: 'txhash' })
  })
  afterEach(() => vi.useRealTimers())

  it('does not render a purpose field, privacy toggle, or privacy secret anywhere in the flow', async () => {
    render(<RequestLoanPage />)
    await fillAmountAndAdvance()
    await advanceToReview()

    expect(screen.queryByLabelText(/Loan Purpose/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Privacy Mode/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Privacy Secret/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Enable Privacy Mode/)).not.toBeInTheDocument()
  })

  it('validation: a zero amount is rejected client-side and never reaches requestLoan', async () => {
    render(<RequestLoanPage />)
    // '0' is a non-empty string, so the Next button's `!formData.amount`
    // guard doesn't catch it — the numeric check in handleSubmit must.
    await fillAmountAndAdvance('0')
    await advanceToReview()

    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Please enter a valid loan amount'))
    expect(mockRequestLoan).not.toHaveBeenCalled()
  })

  describe('maximum loan derived from treasury and policy ratio', () => {
    // 5,000 tokens * 20% (2000 bps) = 1,000 tokens
    const loadedStats = {
      features: { documentStorage: true },
      initialized: true,
      treasuryBalance: BigInt(5_000) * BigInt(10 ** 7),
      maxLoanToTreasuryRatio: 2000,
    }

    it('shows the derived cap as the input max and helper text, not a hard-coded figure', () => {
      mockStats = { ...loadedStats, treasuryBalance: BigInt(50_000) * BigInt(10 ** 7) }
      render(<RequestLoanPage />)

      expect(screen.getByLabelText(/Loan Amount/)).toHaveAttribute('max', '10000')
      expect(screen.getByText(/Maximum loan amount: 10000 /)).toBeInTheDocument()
    })

    it('shows a loading placeholder and no max until the stats have loaded', () => {
      render(<RequestLoanPage />)

      expect(screen.getByLabelText(/Loan Amount/)).not.toHaveAttribute('max')
      expect(screen.getByText(/Maximum loan amount: loading/)).toBeInTheDocument()
    })

    it('rejects an amount above the cap before it reaches requestLoan', async () => {
      mockStats = loadedStats
      render(<RequestLoanPage />)
      await fillAmountAndAdvance('1000.5')
      await advanceToReview()

      fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))

      await waitFor(() =>
        expect(mockToastError).toHaveBeenCalledWith('Amount exceeds the current maximum loan of 1000')
      )
      expect(mockRequestLoan).not.toHaveBeenCalled()
    })

    it('accepts an amount exactly at the cap', async () => {
      mockStats = loadedStats
      render(<RequestLoanPage />)
      await fillAmountAndAdvance('1000')
      await advanceToReview()

      fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))

      await waitFor(() => expect(mockRequestLoan).toHaveBeenCalledWith(BigInt(1000) * BigInt(10 ** 7)))
    })
  })

  it('requests the loan with only the parsed amount', async () => {
    render(<RequestLoanPage />)
    await fillAmountAndAdvance('10')
    await advanceToReview()

    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))

    await waitFor(() => expect(mockRequestLoan).toHaveBeenCalledTimes(1))
    expect(mockRequestLoan).toHaveBeenCalledWith(BigInt(10) * BigInt(10 ** 7))
    expect(mockAttach).not.toHaveBeenCalled()
  })

  it('attaches the manually entered document hash to the new proposal id after the loan is created', async () => {
    render(<RequestLoanPage />)
    await fillAmountAndAdvance('10')

    fireEvent.change(screen.getByLabelText(/Or enter IPFS hash manually/), {
      target: { value: 'QmTestHash' },
    })
    await advanceToReview()

    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))

    await waitFor(() => expect(mockAttach).toHaveBeenCalledWith('Loan', 42, 'QmTestHash'))
  })

  it('reports a partial failure instead of a single atomic success when attach_document fails', async () => {
    mockAttach.mockRejectedValue(new Error('attach failed'))
    render(<RequestLoanPage />)
    await fillAmountAndAdvance('10')

    fireEvent.change(screen.getByLabelText(/Or enter IPFS hash manually/), {
      target: { value: 'QmTestHash' },
    })
    await advanceToReview()

    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringMatching(/loan request was submitted.*attaching the document failed/i)
      )
    )
    // The loan itself still succeeded — the page still reports success and
    // schedules the redirect rather than treating the whole submission as failed.
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Loan request submitted successfully!'))
  })
})

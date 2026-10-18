// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useLoanTerms } from '@/hooks/dao/reads'

const mockCalculateLoanTerms = vi.fn()

vi.mock('@/lib/stellar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar')>('@/lib/stellar')
  return { ...actual, isContractConfigured: () => true }
})

vi.mock('@/lib/dao-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dao-client')>('@/lib/dao-client')
  return {
    ...actual,
    daoRead: {
      ...actual.daoRead,
      calculateLoanTerms: (...a: unknown[]) => mockCalculateLoanTerms(...a),
    },
  }
})

type Result = ReturnType<typeof useLoanTerms>

function Harness({ amount, onRender }: { amount: bigint | null; onRender: (r: Result) => void }) {
  onRender(useLoanTerms(amount))
  return null
}

function mount(amount: bigint | null, onRender: (r: Result) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = (a: bigint | null) => (
    <QueryClientProvider client={client}>
      <Harness amount={a} onRender={onRender} />
    </QueryClientProvider>
  )
  const view = render(ui(amount))
  return { rerender: (a: bigint | null) => view.rerender(ui(a)) }
}

describe('useLoanTerms', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('prices the amount with calculate_loan_terms and maps the result', async () => {
    mockCalculateLoanTerms.mockResolvedValue({
      interest_rate: 1250,
      total_repayment: BigInt(1_125_000_000),
      duration: BigInt(31_536_000),
    })
    let last: Result | undefined

    mount(BigInt(1_000_000_000), (r) => (last = r))

    expect(last).toEqual({ terms: null, isLoading: true, isError: false })
    await waitFor(() => expect(last?.terms).not.toBeNull())
    expect(mockCalculateLoanTerms).toHaveBeenCalledWith(BigInt(1_000_000_000))
    expect(last?.terms).toEqual({
      interestRate: 1250,
      totalRepayment: BigInt(1_125_000_000),
      duration: 31_536_000,
    })
  })

  it('does not call the contract for a null or zero amount', async () => {
    let last: Result | undefined
    const { rerender } = mount(null, (r) => (last = r))
    rerender(BigInt(0))

    await new Promise((r) => setTimeout(r, 400))
    expect(mockCalculateLoanTerms).not.toHaveBeenCalled()
    expect(last).toEqual({ terms: null, isLoading: false, isError: false })
  })

  it('never reports the previous amount\'s terms against a new amount', async () => {
    mockCalculateLoanTerms.mockImplementation(async (amount: bigint) => ({
      interest_rate: 500,
      total_repayment: amount + amount / BigInt(20),
      duration: 86_400,
    }))
    let last: Result | undefined
    const { rerender } = mount(BigInt(100), (r) => (last = r))
    await waitFor(() => expect(last?.terms?.totalRepayment).toBe(BigInt(105)))

    rerender(BigInt(200))
    expect(last?.terms).toBeNull()
    expect(last?.isLoading).toBe(true)
    await waitFor(() => expect(last?.terms?.totalRepayment).toBe(BigInt(210)))
  })

  it('surfaces a failed read as an error rather than terms', async () => {
    mockCalculateLoanTerms.mockRejectedValue(new Error('simulation failed'))
    let last: Result | undefined

    mount(BigInt(100), (r) => (last = r))

    await waitFor(() => expect(last?.isError).toBe(true))
    expect(last?.terms).toBeNull()
  })
})

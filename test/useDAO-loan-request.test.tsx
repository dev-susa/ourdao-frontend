// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useLoanRequest, useAttachDocument } from '@/hooks/useDAO'

const mockRequestLoan = vi.fn()
const mockAttachDocument = vi.fn()

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: 'GALICE',
    isConnected: true,
    signXDR: vi.fn(),
  }),
}))

vi.mock('@/lib/dao-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dao-client')>()
  return {
    ...actual,
    daoWrite: () => ({
      requestLoan: (...args: unknown[]) => mockRequestLoan(...args),
      attachDocument: (...args: unknown[]) => mockAttachDocument(...args),
    }),
  }
})

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => 'id') },
}))

function LoanRequestHarness({ onRender }: { onRender: (h: ReturnType<typeof useLoanRequest>) => void }) {
  const hook = useLoanRequest()
  onRender(hook)
  return null
}

function AttachHarness({ onRender }: { onRender: (h: ReturnType<typeof useAttachDocument>) => void }) {
  const hook = useAttachDocument()
  onRender(hook)
  return null
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('useLoanRequest', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('takes only an amount and resolves to the on-chain proposal id, not the raw invoke result', async () => {
    mockRequestLoan.mockResolvedValue({ hash: 'txhash', returnValue: 7 })
    let latest: ReturnType<typeof useLoanRequest> | undefined
    renderWithClient(<LoanRequestHarness onRender={(h) => { latest = h }} />)

    let resolved: number | undefined
    await act(async () => {
      resolved = await latest!.requestLoan(BigInt(100))
    })

    expect(mockRequestLoan).toHaveBeenCalledWith(BigInt(100))
    expect(resolved).toBe(7)
  })
})

describe('useAttachDocument', () => {
  beforeEach(() => vi.clearAllMocks())

  it('encodes the content hash and targets the given proposal kind/id', async () => {
    mockAttachDocument.mockResolvedValue({ hash: 'txhash', returnValue: null })
    let latest: ReturnType<typeof useAttachDocument> | undefined
    renderWithClient(<AttachHarness onRender={(h) => { latest = h }} />)

    await act(async () => {
      await latest!.attach('Loan', 42, 'QmTestHash')
    })

    expect(mockAttachDocument).toHaveBeenCalledTimes(1)
    const [kind, proposalId, bytes] = mockAttachDocument.mock.calls[0]
    expect(kind).toBe('Loan')
    expect(proposalId).toBe(42)
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe('QmTestHash')
  })

  it('rejects when the attach call fails, surfacing the underlying error to the caller', async () => {
    mockAttachDocument.mockRejectedValue(new Error('boom'))
    let latest: ReturnType<typeof useAttachDocument> | undefined
    renderWithClient(<AttachHarness onRender={(h) => { latest = h }} />)

    await expect(
      act(async () => {
        await latest!.attach('Loan', 42, 'QmTestHash')
      })
    ).rejects.toThrow('boom')
  })
})

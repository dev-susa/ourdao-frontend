// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useHasVoted } from '@/hooks/dao/proposal-reads'

const mockHasVoted = vi.fn()

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({ address: 'GALICE', isConnected: true }),
}))

vi.mock('@/lib/stellar', () => ({
  CONTRACT_ID: 'C123',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  isContractConfigured: () => true,
  server: {},
}))

vi.mock('@/lib/dao-client', () => ({
  daoRead: {
    hasVoted: (...args: unknown[]) => mockHasVoted(...args),
  },
  daoWrite: () => ({}),
}))

function Harness({
  kind,
  proposalId,
  onRender,
}: {
  kind: 'Loan' | 'Treasury'
  proposalId: number
  onRender: (hook: ReturnType<typeof useHasVoted>) => void
}) {
  const hook = useHasVoted(kind, proposalId)
  onRender(hook)
  return null
}

function renderHasVoted(kind: 'Loan' | 'Treasury', proposalId: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let latest: ReturnType<typeof useHasVoted> | undefined
  render(
    <QueryClientProvider client={client}>
      <Harness kind={kind} proposalId={proposalId} onRender={(h) => { latest = h }} />
    </QueryClientProvider>
  )
  return () => latest!
}

describe('useHasVoted', () => {
  beforeEach(() => mockHasVoted.mockReset())
  afterEach(() => vi.clearAllMocks())

  it('reports false before the connected address has voted', async () => {
    mockHasVoted.mockResolvedValue(false)
    const latest = renderHasVoted('Loan', 1)
    await waitFor(() => expect(mockHasVoted).toHaveBeenCalledWith('Loan', 1, 'GALICE'))
    await waitFor(() => expect(latest().hasVoted).toBe(false))
  })

  it('reports true once the connected address has voted', async () => {
    mockHasVoted.mockResolvedValue(true)
    const latest = renderHasVoted('Loan', 2)
    await waitFor(() => expect(latest().hasVoted).toBe(true))
  })

  it('reports true for a committed-but-unrevealed private treasury vote, matching the contract\'s single boolean', async () => {
    // The contract's has_voted folds "committed" and "revealed" into the same
    // true — there is no separate view to tell them apart (see
    // daoRead.hasVoted's doc comment). The hook just passes that through.
    mockHasVoted.mockResolvedValue(true)
    const latest = renderHasVoted('Treasury', 3)
    await waitFor(() => expect(mockHasVoted).toHaveBeenCalledWith('Treasury', 3, 'GALICE'))
    await waitFor(() => expect(latest().hasVoted).toBe(true))
  })
})

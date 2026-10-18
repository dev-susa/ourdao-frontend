// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import LoansPage from '@/app/(app)/loans/page'
import { BackendError } from '@/lib/backend'

// #230: with the indexer unreachable the loans page used to read the count as
// 0 and render "No proposals found" / "Be the first to request a loan!".

const mockGetStats = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/loans',
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
    isMember: vi.fn().mockResolvedValue(true),
    isAdmin: vi.fn().mockResolvedValue(false),
    getMember: vi.fn().mockResolvedValue(null),
    getPendingYield: vi.fn().mockResolvedValue(BigInt(0)),
    getLoanProposal: vi.fn().mockResolvedValue(null),
  },
  daoWrite: () => ({}),
}))

vi.mock('@/lib/backend', async () => {
  const actual = await vi.importActual<typeof import('@/lib/backend')>('@/lib/backend')
  return {
    ...actual,
    backend: {
      getLoans: vi.fn().mockResolvedValue([]),
      getNotifications: vi.fn().mockResolvedValue([]),
      getEvents: vi.fn().mockResolvedValue([]),
      getStats: (...a: unknown[]) => mockGetStats(...a),
      getAdminLog: vi.fn().mockResolvedValue([]),
      markNotificationRead: vi.fn(),
      markAllNotificationsRead: vi.fn(),
    },
  }
})

describe('LoansPage when the proposal count cannot be loaded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a load failure with a retry, not the empty state', async () => {
    mockGetStats.mockRejectedValue(new BackendError('Backend unreachable'))
    renderWithProviders(<LoansPage />)

    expect(await screen.findByTestId('load-error')).toHaveTextContent("Couldn't load loan proposals")
    expect(screen.queryByText('No proposals found')).not.toBeInTheDocument()
    expect(screen.queryByText('Be the first to request a loan!')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('retry refetches and, once the indexer is back, shows the genuine empty state', async () => {
    mockGetStats.mockRejectedValueOnce(new BackendError('down'))
    mockGetStats.mockResolvedValue({ totalLoanProposals: 0 })
    renderWithProviders(<LoansPage />)

    await screen.findByTestId('load-error')
    screen.getByRole('button', { name: 'Try again' }).click()

    await waitFor(() => expect(screen.getByText('No proposals found')).toBeInTheDocument())
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument()
  })
})

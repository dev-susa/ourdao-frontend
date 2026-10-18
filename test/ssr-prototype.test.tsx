// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import React from 'react'
import { renderWithProviders } from './test-utils'
import LoansPage from '@/app/(app)/loans/page'

const mockIsMember = vi.fn()
const mockGetLoanProposal = vi.fn()
const mockGetStats = vi.fn()
const mockGetLoans = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/loans',
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: null,
    isConnected: false,
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
    isMember: (...args: unknown[]) => mockIsMember(...args),
    isAdmin: () => Promise.resolve(false),
    getMember: () => Promise.resolve(null),
    getPendingYield: () => Promise.resolve(0),
    getLoanProposal: (...args: unknown[]) => mockGetLoanProposal(...args),
  },
  daoWrite: () => ({}),
}))

vi.mock('@/lib/backend', () => ({
  backend: {
    getLoans: (...args: unknown[]) => mockGetLoans(...args),
    getStats: (...args: unknown[]) => mockGetStats(...args),
    getEvents: () => Promise.resolve([]),
    getNotifications: () => Promise.resolve([]),
    getAdminLog: () => Promise.resolve([]),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
  isBackendConfigured: () => true,
}))

describe('SSR Prototyping & First Paint rendering (#243)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsMember.mockResolvedValue(false)
    mockGetLoans.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders initial overview layout on first paint even when wallet is disconnected', async () => {
    mockGetStats.mockResolvedValue({ totalLoanProposals: 0 })
    renderWithProviders(<LoansPage />)

    // First paint delivers PageHeader and Overview metrics immediately
    expect(screen.getByText('Loan Proposals')).toBeInTheDocument()
    expect(screen.getByText('Browse and vote on member loan requests')).toBeInTheDocument()
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Total Proposals')).toBeInTheDocument()
    expect(screen.getByText('Filter & Search')).toBeInTheDocument()
  })

  it('wallet-dependent actions (like Request Loan) are hidden for disconnected visitors', () => {
    mockGetStats.mockResolvedValue({ totalLoanProposals: 0 })
    renderWithProviders(<LoansPage />)

    expect(screen.queryByRole('link', { name: /Request Loan/i })).not.toBeInTheDocument()
  })
})

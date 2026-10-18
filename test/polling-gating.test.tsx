// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { useUserData, useDAOStats, useDAOEvents } from '@/hooks/dao/reads'
import { useLoanProposals } from '@/hooks/dao/proposal-reads'
import { useAutoNotifications } from '@/hooks/useNotifications'

const mockGetLoans = vi.fn()
const mockGetStats = vi.fn()
const mockGetEvents = vi.fn()
const mockGetNotifications = vi.fn()
const mockIsMember = vi.fn()

let mockWalletAddress: string | null = 'GALICE'
let mockWalletConnected = true

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: mockWalletAddress,
    isConnected: mockWalletConnected,
    signXDR: vi.fn(),
  }),
}))

vi.mock('@/lib/stellar', () => ({
  isContractConfigured: () => true,
  CONTRACT_ID: 'CTEST',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}))

vi.mock('@/lib/dao-client', () => ({
  daoRead: {
    isMember: (...args: unknown[]) => mockIsMember(...args),
    isAdmin: () => Promise.resolve(false),
    getMember: () => Promise.resolve(null),
    getPendingYield: () => Promise.resolve(0),
    getTotalMembers: () => Promise.resolve(10),
    getActiveMembers: () => Promise.resolve(8),
    getConsensusThreshold: () => Promise.resolve(5100),
    getTreasuryBalance: () => Promise.resolve(BigInt(1000000)),
    getLoanPolicy: () => Promise.resolve({}),
    isPaused: () => Promise.resolve(false),
  },
  daoWrite: () => ({}),
}))

vi.mock('@/lib/backend', () => ({
  backend: {
    getLoans: (...args: unknown[]) => mockGetLoans(...args),
    getStats: (...args: unknown[]) => mockGetStats(...args),
    getEvents: (...args: unknown[]) => mockGetEvents(...args),
    getNotifications: (...args: unknown[]) => mockGetNotifications(...args),
    getAdminLog: vi.fn().mockResolvedValue([]),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
  isBackendConfigured: () => !!process.env.NEXT_PUBLIC_BACKEND_URL,
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('Polling and query gating (#242)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWalletAddress = 'GALICE'
    mockWalletConnected = true
    mockGetLoans.mockResolvedValue([])
    mockGetStats.mockResolvedValue({ totalLoans: 0, totalLoanProposals: 0, totalTreasuryProposals: 0 })
    mockGetEvents.mockResolvedValue([])
    mockGetNotifications.mockResolvedValue([])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not poll backend.getLoans or other backend endpoints when backend is unconfigured', async () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', '')
    mockIsMember.mockResolvedValue(true)

    const wrapper = createWrapper()
    const { result: userRes } = renderHook(() => useUserData(), { wrapper })
    renderHook(() => useDAOStats(), { wrapper })
    renderHook(() => useDAOEvents(), { wrapper })
    renderHook(() => useLoanProposals(), { wrapper })
    renderHook(() => useAutoNotifications(), { wrapper })

    await waitFor(() => expect(userRes.current.isLoading).toBe(false))

    expect(mockGetLoans).not.toHaveBeenCalled()
    expect(mockGetStats).not.toHaveBeenCalled()
    expect(mockGetEvents).not.toHaveBeenCalled()
    expect(mockGetNotifications).not.toHaveBeenCalled()
    expect(userRes.current.loans).toEqual([])
  })

  it('does not poll backend.getLoans for a connected non-member even when backend is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', 'http://localhost:4000')
    mockIsMember.mockResolvedValue(false)

    const wrapper = createWrapper()
    const { result } = renderHook(() => useUserData(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isMember).toBe(false)

    // Loans should not be fetched for non-member
    expect(mockGetLoans).not.toHaveBeenCalled()
    expect(result.current.loans).toEqual([])
  })

  it('polls backend.getLoans when connected user is a confirmed member and backend is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', 'http://localhost:4000')
    mockIsMember.mockResolvedValue(true)
    mockGetLoans.mockResolvedValue([
      {
        id: 1,
        borrower: 'GALICE',
        amount: '1000',
        outstanding: '500',
        total_repayment: '1100',
        due_time: 1700000000,
        status: 'active',
        approved_ledger: 10,
        repaid_ledger: null,
        defaulted_ledger: null,
        updated_at: '2026-01-01',
      },
    ])

    const wrapper = createWrapper()
    const { result } = renderHook(() => useUserData(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isMember).toBe(true)

    await waitFor(() => expect(mockGetLoans).toHaveBeenCalledWith('GALICE'))
    expect(result.current.loans.length).toBe(1)
    expect(result.current.loans[0].id).toBe(1)
  })
})

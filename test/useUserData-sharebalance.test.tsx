import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useUserData } from '@/hooks/dao/reads'
import { daoRead } from '@/lib/dao-client'

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: 'GABROWSER123',
    isConnected: true,
  }),
}))

vi.mock('@/lib/stellar', () => ({
  CONTRACT_ID: 'CCONTRACT123',
  isContractConfigured: () => true,
}))

vi.mock('@/lib/backend', () => ({
  backend: {
    getLoans: () => Promise.resolve([]),
    getStats: () => Promise.resolve(null),
  },
}))

describe('useUserData - shareBalance live treasury claim', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    vi.spyOn(daoRead, 'isMember').mockResolvedValue(true)
    vi.spyOn(daoRead, 'isAdmin').mockResolvedValue(false)
    vi.spyOn(daoRead, 'getMember').mockResolvedValue({
      address: 'GABROWSER123',
      status: 'ActiveMember',
      join_time: 100,
      contribution: '1000000',
      share_balance: '1000000', // frozen historical fee
      has_active_loan: false,
      last_loan_time: 0,
    })
    vi.spyOn(daoRead, 'getPendingYield').mockResolvedValue(BigInt(0))
    // Dynamic claim on treasury from calculate_exit_share
    vi.spyOn(daoRead, 'calculateExitShare').mockResolvedValue(BigInt(5000000))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  it('populates member.shareBalance from calculate_exit_share rather than frozen m.share_balance', async () => {
    const { result } = renderHook(() => useUserData(), { wrapper })

    await waitFor(() => {
      expect(result.current.member).toBeDefined()
    })

    expect(daoRead.calculateExitShare).toHaveBeenCalledWith('GABROWSER123')
    // Historical contribution matches m.contribution
    expect(result.current.member?.contributionAmount).toBe(BigInt(1000000))
    // Current live share balance / treasury claim matches calculate_exit_share (5000000), not frozen m.share_balance (1000000)
    expect(result.current.member?.shareBalance).toBe(BigInt(5000000))
  })
})

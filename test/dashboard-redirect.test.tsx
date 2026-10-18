// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { UserData } from '@/types/dao'

// #69: a pending membership query must not be treated as "not a member" —
// this is the exact regression the issue describes: DashboardPage's
// redirect effect firing while isMember is still the loading default.

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockUserData = vi.fn<() => UserData>()
vi.mock('@/hooks/useDAO', () => ({
  useDAOStats: () => ({
    totalMembers: 0,
    activeMembers: 0,
    totalLoans: 0,
    activeLoans: 0,
    treasuryBalance: BigInt(0),
    totalYieldGenerated: BigInt(0),
    totalRestaked: BigInt(0),
    initialized: true,
    isPaused: false,
    membershipFee: BigInt(0),
    consensusThreshold: 0,
    features: {
      ensVoting: false,
      documentStorage: false,
      privateVoting: false,
      confidentialLoans: false,
      restaking: false,
    },
  }),
  useUserData: () => mockUserData(),
  useRewards: () => ({
    claimRewards: vi.fn(),
    isPending: false,
    isSuccess: false,
  }),
  useDAOEvents: () => ({ events: [], setEvents: vi.fn() }),
  eventLabel: (s: unknown) => String(s),
}))

vi.mock('@/lib/responsive', () => ({
  useIsMobile: () => false,
  useResponsiveCardLayout: () => ({ getCardGridClass: () => 'grid-cols-4' }),
  // LoadingSpinner (rendered while userData.isLoading) pulls this in
  // transitively via ui/skeleton.tsx.
  useNetworkAware: () => ({ shouldOptimize: false }),
}))

const baseUserData: UserData = {
  isConnected: true,
  address: 'GALICE',
  isLoading: false,
  isMember: false,
  isAdmin: false,
  votingWeight: 1,
  pendingYield: BigInt(0),
  hasActiveLoan: false,
  loans: [],
}

async function renderDashboard() {
  // Moved into the (app) route group upstream — AppShell is now applied
  // once by (app)/layout.tsx rather than per-page, so this page no longer
  // needs its own AppShell mock.
  const { default: DashboardPage } = await import('@/app/(app)/dashboard/page')
  return render(<DashboardPage />)
}

describe('DashboardPage membership redirect', () => {
  beforeEach(() => {
    mockPush.mockClear()
  })
  afterEach(() => vi.clearAllMocks())

  it('does not redirect to /register while the membership query is still pending', async () => {
    mockUserData.mockReturnValue({ ...baseUserData, isLoading: true, isMember: false })
    await renderDashboard()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('renders a loading state instead of the "Not a Member" card while pending', async () => {
    mockUserData.mockReturnValue({ ...baseUserData, isLoading: true, isMember: false })
    await renderDashboard()
    expect(screen.queryByText('Not a Member')).not.toBeInTheDocument()
  })

  it('redirects to /register once the read settles and confirms non-membership', async () => {
    mockUserData.mockReturnValue({ ...baseUserData, isLoading: false, isMember: false })
    await renderDashboard()
    expect(mockPush).toHaveBeenCalledWith('/register')
  })

  it('does not redirect once the read settles and confirms membership', async () => {
    mockUserData.mockReturnValue({
      ...baseUserData,
      isLoading: false,
      isMember: true,
      member: {
        memberAddress: 'GALICE',
        status: 1,
        joinDate: 0,
        contributionAmount: BigInt(0),
        shareBalance: BigInt(0),
        hasActiveLoan: false,
        lastLoanDate: 0,
      },
    })
    await renderDashboard()
    expect(mockPush).not.toHaveBeenCalled()
  })
  it('#230: a failed membership read is a load error, not "not a member" — no redirect, retry offered', async () => {
    const refetch = vi.fn()
    mockUserData.mockReturnValue({ ...baseUserData, isLoading: false, isMember: false, isError: true, refetch })
    await renderDashboard()
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.queryByText('Not a Member')).not.toBeInTheDocument()
    expect(screen.getByTestId('load-error')).toHaveTextContent("Couldn't load your membership data")
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(refetch).toHaveBeenCalledOnce()
  })
})

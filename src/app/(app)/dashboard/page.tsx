'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ConnectButton } from '@/components/ConnectButton'
import Link from 'next/link'
import {
  BanknotesIcon,
  UsersIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  ShieldCheckIcon,
  CheckCircleIcon,
  ArrowUpRightIcon,
  TrophyIcon,
} from '@heroicons/react/24/outline'
import { useDAOStats, useUserData, useRewards, useDAOEvents, eventLabel } from '@/hooks/useDAO'
import { formatToken, formatDate, formatAddress } from '@/lib/utils'
import { MEMBER_STATUS_LABELS, NON_MEMBER_LABEL } from '@/constants'
import toast from 'react-hot-toast'
import { useIsMobile, useResponsiveCardLayout } from '@/lib/responsive'
import { LoadingSpinner } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/PageHeader'

export default function DashboardPage() {
  const router = useRouter()
  const stats = useDAOStats()
  const userData = useUserData()
  const { claimRewards, claimYield, isPending, isSuccess } = useRewards()
  const { events } = useDAOEvents()
  const isMobile = useIsMobile()
  const { getCardGridClass } = useResponsiveCardLayout()

  useEffect(() => {
    // Wait for the membership read to settle before deciding — otherwise
    // this fires while isMember is still the "not yet known" default
    // (false), bouncing every legitimate member through /register on every
    // load (#69).
    if (userData.isConnected && !userData.isLoading && !userData.isMember) {
      router.push('/register')
    }
  }, [userData.isConnected, userData.isLoading, userData.isMember, router])

  useEffect(() => {
    if (isSuccess) {
      toast.success('Rewards claimed successfully!')
    }
  }, [isSuccess])

  const handleClaimRewards = async () => {
    await claimRewards()
  }

  const handleClaimYield = async () => {
    await claimYield()
  }

  if (!userData.isConnected) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Access Dashboard</CardTitle>
            <CardDescription>
              Connect your wallet to access the member dashboard
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <Button onClick={openConnectModal} className="w-full" size="lg">
                  Connect Wallet
                </Button>
              )}
            </ConnectButton.Custom>
            <div className="text-center">
              <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
                ← Back to Home
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (userData.isLoading) {
    // Same "not yet known" collapse as isAdmin on the admin panel (#69) —
    // isMember reads false until the query resolves, which would otherwise
    // redirect to /register and flash the "Not a Member" card on every
    // load. No AppShell wrapper needed — the (app) route-group layout
    // already provides it.
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!userData.isMember) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Not a Member</CardTitle>
            <CardDescription>
              You need to be a DAO member to access the dashboard
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild className="w-full" size="lg">
              <Link href="/register">
                Join the DAO
              </Link>
            </Button>
            <div className="text-center">
              <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
                ← Back to Home
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const quickActions = [
    {
      title: 'Request Loan',
      description: 'Submit a new loan proposal',
      icon: BanknotesIcon,
      href: '/loans/request',
      color: 'text-green-600 dark:text-green-400',
    },
    {
      title: 'View Loans',
      description: 'Browse and vote on loan proposals',
      icon: UsersIcon,
      href: '/loans',
      color: 'text-blue-600 dark:text-blue-400',
    },
    {
      title: 'Governance',
      description: 'Vote on proposals and participate in DAO decisions',
      icon: ChartBarIcon,
      href: '/governance',
      color: 'text-indigo-600 dark:text-indigo-400',
    },
    {
      title: 'Treasury',
      description: 'View treasury status and restaking',
      icon: ChartBarIcon,
      href: '/treasury',
      color: 'text-purple-600 dark:text-purple-400',
    },
    {
      title: 'Privacy Settings',
      description: 'Manage privacy preferences',
      icon: ShieldCheckIcon,
      href: '/privacy',
      color: 'text-yellow-600 dark:text-yellow-400',
    },
    ...(userData.member?.status === 3 ? [{
      title: 'Admin Panel',
      description: 'Manage DAO operations and configuration',
      icon: ShieldCheckIcon,
      href: '/admin',
      color: 'text-red-600 dark:text-red-400',
    }] : [])
  ]

  const memberStatusColor = userData.member?.status === 1 ? 'text-green-600' : 'text-muted-foreground'
  const memberStatusBg = userData.member?.status === 1 ? 'bg-green-50' : 'bg-muted'

  return (
    <>
      <PageHeader
        title="Member Dashboard"
        subtitle="Your membership, rewards, and activity at a glance"
      />
        {/* Member Status */}
        <div className="mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className={`p-3 rounded-full ${memberStatusBg}`}>
                    <CheckCircleIcon className={`h-8 w-8 ${memberStatusColor}`} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {formatAddress(userData.address || '')}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Status: {userData.member ? MEMBER_STATUS_LABELS[userData.member.status] : NON_MEMBER_LABEL}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Member since: {formatDate(userData.member?.joinDate || 0)}
                    </p>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="text-sm text-muted-foreground">Voting Weight</div>
                  <div className="text-2xl font-bold text-foreground">{userData.votingWeight}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className={`grid grid-cols-1 ${isMobile ? 'gap-4' : 'lg:grid-cols-3 gap-8'}`}>
          {/* Main Content */}
          <div className={`${isMobile ? 'space-y-4' : 'lg:col-span-2 space-y-8'}`}>
            {/* Stats Cards */}
            <div className={`grid ${getCardGridClass(4)} gap-3 sm:gap-6`}>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/50 mr-4">
                      <CurrencyDollarIcon className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Share Balance</p>
                      <p className="text-2xl font-bold text-foreground">
                        {formatToken(userData.member?.shareBalance || BigInt(0))}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="p-3 rounded-full bg-green-50 dark:bg-green-950/50 mr-4">
                      <TrophyIcon className="h-8 w-8 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Pending Rewards</p>
                      <p className="text-2xl font-bold text-foreground">
                        {formatToken(userData.pendingRewards)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="p-3 rounded-full bg-purple-50 dark:bg-purple-950/50 mr-4">
                      <ChartBarIcon className="h-8 w-8 text-purple-600 dark:text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Yield Available</p>
                      <p className="text-2xl font-bold text-foreground">
                        {formatToken(userData.pendingYield)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="p-3 rounded-full bg-yellow-50 dark:bg-yellow-950/50 mr-4">
                      <BanknotesIcon className={`h-8 w-8 ${userData.hasActiveLoan ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Active Loan</p>
                      <p className="text-2xl font-bold text-foreground">
                        {userData.hasActiveLoan ? 'Yes' : 'No'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Rewards Section */}
            {(userData.pendingRewards > BigInt(0) || userData.pendingYield > BigInt(0)) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <TrophyIcon className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mr-2" />
                    Available Rewards
                  </CardTitle>
                  <CardDescription>
                    You have rewards available to claim
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
                    <div>
                      <p className="font-medium text-green-900 dark:text-green-300">Governance Rewards</p>
                      <p className="text-sm text-green-700 dark:text-green-400">{formatToken(userData.pendingRewards)}</p>
                    </div>
                    <Button 
                      onClick={handleClaimRewards} 
                      disabled={userData.pendingRewards === BigInt(0) || isPending}
                      size="sm"
                    >
                      {isPending ? 'Claiming...' : 'Claim'}
                    </Button>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 bg-purple-50 dark:bg-purple-950/30 rounded-lg">
                    <div>
                      <p className="font-medium text-purple-900 dark:text-purple-300">Restaking Yield</p>
                      <p className="text-sm text-purple-700 dark:text-purple-400">{formatToken(userData.pendingYield)}</p>
                    </div>
                    <Button 
                      onClick={handleClaimYield} 
                      disabled={userData.pendingYield === BigInt(0) || isPending}
                      variant="outline"
                      size="sm"
                    >
                      {isPending ? 'Claiming...' : 'Claim'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>
                  Common tasks and features you can access
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {quickActions.map((action) => {
                    const Icon = action.icon
                    return (
                      <Link key={action.title} href={action.href}>
                        <div className="p-4 border border-border rounded-lg hover:border-input hover:shadow-sm transition-all cursor-pointer">
                          <div className="flex items-start space-x-3">
                            <Icon className={`h-6 w-6 ${action.color} mt-1`} />
                            <div>
                              <h3 className="font-medium text-foreground">{action.title}</h3>
                              <p className="text-sm text-muted-foreground">{action.description}</p>
                            </div>
                            <ArrowUpRightIcon className="h-4 w-4 text-muted-foreground ml-auto" />
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className={`${isMobile ? 'space-y-4' : 'space-y-8'}`}>
            {/* DAO Overview */}
            <Card>
              <CardHeader>
                <CardTitle>DAO Overview</CardTitle>
                <CardDescription>Current DAO statistics</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total Members</span>
                  <span className="font-medium">{stats.totalMembers}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Active Members</span>
                  <span className="font-medium">{stats.activeMembers}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Treasury Balance</span>
                  <span className="font-medium">{formatToken(stats.treasuryBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total Yield</span>
                  <span className="font-medium">{formatToken(stats.totalYieldGenerated)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Feature Status */}
            <Card>
              <CardHeader>
                <CardTitle>Feature Status</CardTitle>
                <CardDescription>Available DAO features</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">ENS Voting</span>
                  <div className={`w-2 h-2 rounded-full ${stats.features.ensVoting ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Document Storage</span>
                  <div className={`w-2 h-2 rounded-full ${stats.features.documentStorage ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Private Voting</span>
                  <div className={`w-2 h-2 rounded-full ${stats.features.privateVoting ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Confidential Loans</span>
                  <div className={`w-2 h-2 rounded-full ${stats.features.confidentialLoans ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Restaking</span>
                  <div className={`w-2 h-2 rounded-full ${stats.features.restaking ? 'bg-green-500' : 'bg-muted-foreground'}`} />
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest DAO events</CardDescription>
              </CardHeader>
              <CardContent>
                {events.length > 0 ? (
                  <div className="space-y-3">
                    {events.slice(0, 5).map((event, index) => (
                      <div key={index} className="flex items-center space-x-3 text-sm">
                        <div className="w-2 h-2 bg-blue-500 rounded-full" />
                        <span className="text-muted-foreground">{eventLabel(event?.symbol)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No recent activity</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
    </>
  )
}

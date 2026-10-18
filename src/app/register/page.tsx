'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConnectButton } from '@/components/ConnectButton'
import Link from 'next/link'
import {
  UserIcon,
  CurrencyDollarIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
} from '@/lib/icons'
import { useDAOStats, useUserData, useMemberRegistration, useToken } from '@/hooks/useDAO'
import { useRedirectIfMember } from '@/hooks/useRequireMember'
import { formatToken } from '@/lib/utils'
import { CardSkeleton } from '@/components/ui/skeleton'
import toast from 'react-hot-toast'
import { MAIN_CONTENT_ID } from '@/lib/a11y'

export default function RegisterPage() {
  const router = useRouter()
  const stats = useDAOStats()
  const userData = useUserData()
  const token = useToken()
  const { registerMember, isPending, error, isSuccess } = useMemberRegistration()

  const membershipFee = BigInt(stats.membershipFee || 0)
  const hasSufficientBalance = token.balance >= membershipFee
  
  const [formData, setFormData] = useState({
    acceptTerms: false,
  })

  const [step, setStep] = useState(1)
  const maxSteps = 2

  // The mirror of the dashboard's guard, for the same reason (#307): wait for
  // the wallet to finish restoring and the membership read to settle before
  // deciding this visitor is already a member. Otherwise a hard refresh on
  // /register could send a connected member to /dashboard, or leave a
  // just-registered member staring at the form until a manual reload.
  const { isResolving } = useRedirectIfMember('/dashboard', userData)

  useEffect(() => {
    if (isSuccess) {
      toast.success('Registration successful! Welcome to the DAO!')
      setTimeout(() => router.push('/dashboard'), 2000)
    }
  }, [isSuccess, router])

  useEffect(() => {
    if (error) {
      toast.error('Registration failed. Please try again.')
    }
  }, [error])

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
  // Don't show "Connect Your Wallet" until the restore attempt has settled —
  // during the window it would read true for a wallet that is in fact connected
  // (#307).
  if (isResolving) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-blue-50 dark:from-background dark:to-blue-950/20 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <CardSkeleton />
        </div>
      </div>
    )
  }

  if (!userData.isConnected) {
      toast.error('Please connect your wallet first')
      return
    }

    if (!formData.acceptTerms) {
      toast.error('Please accept the terms and conditions')
      return
    }

    try {
      await registerMember()
    } catch {
      /* error handled by useWriteAction */
    }
  }

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <UserIcon className="h-16 w-16 text-primary-600 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-foreground mb-2">Welcome to OurDAO</h2>
              <p className="text-muted-foreground">
                Join our community of {stats.activeMembers} active members and access advanced DeFi lending features.
              </p>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 dark:bg-blue-950/30 dark:border-blue-900 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 dark:text-blue-300 mb-2">Membership Benefits</h3>
              <ul className="text-sm text-blue-800 dark:text-blue-400 space-y-1">
                <li>• Request loans with competitive interest rates</li>
                <li>• Vote on proposals and governance decisions</li>
                <li>• Earn yield from treasury optimization</li>
                <li>• Access privacy features and confidential transactions</li>
                <li>• Participate in restaking rewards distribution</li>
              </ul>
            </div>

            <div className="bg-muted rounded-lg p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-foreground">Membership Fee:</span>
                <span className="text-xl font-bold text-foreground">
                  {token.format(stats.membershipFee)}
                </span>
              </div>
              {userData.isConnected && (
                <div className="flex justify-between items-center text-sm border-t border-border pt-2">
                  <span className="text-muted-foreground">Your {token.symbol} Balance:</span>
                  <span className={`font-medium ${hasSufficientBalance ? 'text-foreground' : 'text-red-500 dark:text-red-400'}`}>
                    {token.format(token.balance)}
                  </span>
                </div>
              )}
              {userData.isConnected && !hasSufficientBalance && (
                <p className="text-xs text-red-500 dark:text-red-400">
                  Insufficient {token.symbol} balance to cover the membership fee.
                </p>
              )}
            </div>
          </div>
        )

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center">
              <CurrencyDollarIcon className="h-16 w-16 text-primary-600 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-foreground mb-2">Complete Registration</h2>
              <p className="text-muted-foreground">
                Review your information and complete the membership registration.
              </p>
            </div>

            <div className="border border-border rounded-lg p-4 space-y-3">
              <h3 className="font-semibold text-foreground">Registration Summary</h3>
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Wallet Address:</span>
                  <span className="font-mono">{userData.address}</span>
                </div>

                <div className="flex justify-between border-t border-border pt-2">
                  <span className="font-medium text-foreground">Membership Fee:</span>
                  <span className="font-bold">{token.format(stats.membershipFee)}</span>
                </div>

                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Your Balance:</span>
                  <span className={`font-medium ${hasSufficientBalance ? 'text-foreground' : 'text-red-500 dark:text-red-400'}`}>
                    {token.format(token.balance)}
                  </span>
                </div>

                {!hasSufficientBalance && (
                  <p className="text-xs text-red-500 dark:text-red-400 pt-1">
                    Insufficient balance to complete registration.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-start">
                <input
                  type="checkbox"
                  id="acceptTerms"
                  className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-input rounded"
                  checked={formData.acceptTerms}
                  onChange={(e) => handleInputChange('acceptTerms', e.target.checked)}
                />
                <label htmlFor="acceptTerms" className="ml-2 text-sm text-foreground">
                  I accept the{' '}
                  <a href="/terms" className="text-primary-600 hover:text-primary-500">
                    Terms and Conditions
                  </a>{' '}
                  and understand that this payment will register me as a DAO member
                </label>
              </div>
            </div>
          </div>
        )

      default:
        return null
    }
  }

  const renderStepIndicator = () => {
    return (
      <div className="flex items-center justify-center space-x-4 mb-8">
        {Array.from({ length: maxSteps }, (_, i) => {
          const stepNumber = i + 1
          const isCompleted = stepNumber < step
          const isCurrent = stepNumber === step
          
          return (
            <div key={stepNumber} className="flex items-center">
              <div
                className={`
                  w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium
                  ${
                    isCompleted
                      ? 'bg-green-500 text-white'
                      : isCurrent
                      ? 'bg-primary-600 text-white'
                      : 'bg-muted text-muted-foreground'
                  }
                `}
              >
                {isCompleted ? <CheckCircleIcon className="h-6 w-6" /> : stepNumber}
              </div>
              {stepNumber < maxSteps && (
                <div
                  className={`w-8 h-0.5 ${
                    stepNumber < step ? 'bg-green-500' : 'bg-muted'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (!userData.isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-blue-50 dark:from-background dark:to-blue-950/20 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Connect Your Wallet</CardTitle>
            <CardDescription>
              Connect your wallet to register for DAO membership
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

  return (
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-h-screen bg-gradient-to-br from-background to-blue-50 py-12 px-4 focus:outline-none dark:from-background dark:to-blue-950/20 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            Back to Home
          </Link>
          <h1 className="text-3xl font-bold text-foreground text-center">Join the DAO</h1>
        </div>

        <Card>
          <CardContent className="p-8">
            {renderStepIndicator()}
            
            <form onSubmit={handleSubmit}>
              {renderStepContent()}
              
              <div className="flex justify-between mt-8">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(Math.max(1, step - 1))}
                  disabled={step === 1}
                >
                  Previous
                </Button>
                
                {step < maxSteps ? (
                  <Button
                    type="button"
                    onClick={() => setStep(Math.min(maxSteps, step + 1))}
                    disabled={userData.isConnected && !hasSufficientBalance}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    loading={isPending}
                    disabled={!formData.acceptTerms || !userData.isConnected || !hasSufficientBalance}
                    className="min-w-[120px]"
                  >
                    {!hasSufficientBalance ? 'Insufficient Balance' : isPending ? 'Registering...' : 'Register Now'}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Registration Status */}
        {isSuccess && (
          <Card className="mt-6 border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
            <CardContent className="p-4">
              <div className="flex items-center">
                <CheckCircleIcon className="h-5 w-5 text-green-600 dark:text-green-400 mr-2" />
                <span className="text-green-800 dark:text-green-300 font-medium">
                  Registration successful! Redirecting to dashboard...
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}

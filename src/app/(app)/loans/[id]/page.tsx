'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import {
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  EyeIcon,
  DocumentTextIcon,
  CalendarIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
} from '@/lib/icons'
import {
  useUserData,
  useDAOStats,
  useVoting,
  useLoanRepayment,
  useLoanProposal,
  useLoan,
  useMarkLoanDefaulted,
  useProposalDocument,
  useAttachDocument,
  type UILoan,
} from '@/hooks/useDAO'
import { useNow } from '@/hooks/useNow'
import { formatToken, formatDate, calculatePercentage, parseToken } from '@/lib/utils'
import { AddressLink } from '@/components/AddressLink'
import { PROPOSAL_STATUS_LABELS, PROPOSAL_STATUS_AWAITING_FUNDS, IPFS_GATEWAY } from '@/constants'
import toast from 'react-hot-toast'
import { PageHeader } from '@/components/PageHeader'
import { DocumentHistory } from '@/components/DocumentHistory'
import { ProposalTimeline } from '@/components/ProposalTimeline'

export default function LoanDetailsPage() {
  const params = useParams()
  const router = useRouter()
  const userData = useUserData()
  const { activeMembers, isPaused } = useDAOStats()
  const { voteOnProposal, isPending: isVoting } = useVoting()
  const { repayLoan, repayLoanPartial, isPending: isRepaying } = useLoanRepayment()
  const { markLoanDefaulted, isPending: isMarkingDefaulted } = useMarkLoanDefaulted()
  const now = useNow()

  const loanId = parseInt(params.id as string)
  const { proposal, isLoading, refetch: refetchProposal } = useLoanProposal(loanId)
  // A LoanProposal only tracks the vote; the real disbursed Loan (due date,
  // repayment status) exists once the proposal is Approved (status 3), and
  // the contract guarantees it carries the same id as the proposal.
  const { loan: realLoan, isLoading: loanLoading, refetch: refetchLoan } = useLoan(
    loanId,
    proposal?.status === 3
  )
  const { cid: documentCid, refetch: refetchDocument } = useProposalDocument('Loan', loanId)
  const { attach, isPending: attaching } = useAttachDocument()
  const [cidInput, setCidInput] = useState('')
  // CIDv0 = Qm… (46 chars base58) or CIDv1 = b… (multibase base32, 59+ chars)
  const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/
  const isCidValid = CID_RE.test(cidInput.trim())
  const [repayAmount, setRepayAmount] = useState('')
  const [repayError, setRepayError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoading && !proposal) {
      toast.error('Loan not found')
      router.push('/loans')
    }
  }, [isLoading, proposal, router])

  // Default the repayment input to the full outstanding balance
  useEffect(() => {
    if (realLoan) {
      const out = realLoan.totalRepayment - realLoan.amountRepaid
      if (out > BigInt(0) && repayAmount === '') {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRepayAmount(formatToken(out, { displayDecimals: 7 }))
      }
    }
  }, [realLoan, repayAmount])

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="skeleton h-40 w-full max-w-2xl rounded-xl" />
      </div>
    )
  }

  if (!proposal) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <XCircleIcon className="h-12 w-12 text-red-500 dark:text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Loan Not Found</h3>
            <p className="text-muted-foreground mb-4">The requested loan proposal does not exist.</p>
            <Button asChild>
              <Link href="/loans">Back to Loans</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleVote = async (support: boolean) => {
    await voteOnProposal(loanId, support)
    refetchProposal()
  }

  const handleRepayment = async () => {
    const trimmed = repayAmount.trim()
    if (!trimmed) {
      setRepayError('Enter an amount')
      return
    }
    if (isNaN(Number(trimmed))) {
      setRepayError('Enter a valid number')
      return
    }
    const parsed = parseToken(trimmed)
    if (parsed <= BigInt(0)) {
      setRepayError('Amount must be greater than zero')
      return
    }
    if (parsed > outstanding) {
      setRepayError(`Amount exceeds outstanding balance of ${formatToken(outstanding)}`)
      return
    }
    setRepayError(null)
    try {
      if (parsed === outstanding) {
        await repayLoan(loanId)
      } else {
        await repayLoanPartial(loanId, parsed)
      }
      setRepayAmount('')
      await Promise.all([refetchLoan(), refetchProposal()])
    } catch {
      // toast handled in hook
    }
  }

  const handleMarkDefaulted = async () => {
    if (!window.confirm('Mark this loan as defaulted? This will slash a share of the borrower\'s treasury claim and cannot be undone.')) return
    await markLoanDefaulted(loanId)
    refetchLoan()
  }

  const getStatusIcon = (status: number) => {
    switch (status) {
      case 1: return <ClockIcon className="h-6 w-6 text-yellow-500 dark:text-yellow-400" />
      case 2: return <ClockIcon className="h-6 w-6 text-blue-500 dark:text-blue-400" />
      case 3: return <CheckCircleIcon className="h-6 w-6 text-green-500 dark:text-green-400" />
      case 4: return <XCircleIcon className="h-6 w-6 text-red-500 dark:text-red-400" />
      case 7: return <ClockIcon className="h-6 w-6 text-amber-500 dark:text-amber-400" />
      default: return <ClockIcon className="h-6 w-6 text-muted-foreground" />
    }
  }

  const getStatusColor = (status: number) => {
    switch (status) {
      case 1: return 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950/30 dark:border-yellow-900'
      case 2: return 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/30 dark:border-blue-900'
      case 3: return 'text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950/30 dark:border-green-900'
      case 4: return 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-900'
    case 7: return 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-900'
      default: return 'text-muted-foreground bg-muted border-border'
    }
  }

  const loanStatusClass = (status: UILoan['status']) => {
    switch (status) {
      case 'Active': return 'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-950/30 dark:border-blue-900'
      case 'Repaid': return 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-950/30 dark:border-green-900'
      case 'Defaulted': return 'text-red-700 bg-red-50 border-red-200 dark:text-red-300 dark:bg-red-950/30 dark:border-red-900'
    }
  }

  const canVote = () => {
    return now !== null &&
           userData.isMember &&
           proposal.status === 2 &&
           !proposal.hasVoted &&
           proposal.borrower !== userData.address &&
           proposal.votingEndTime > Math.floor(now / 1000)
  }

  const alreadyVoted =
    userData.isMember &&
    proposal.status === 2 &&
    proposal.hasVoted &&
    proposal.borrower !== userData.address

  const isBorrower = () => {
    return userData.address?.toLowerCase() === proposal.borrower.toLowerCase()
  }

  const isOverdue =
    realLoan?.status === 'Active' && now !== null && Math.floor(now / 1000) > realLoan.dueTime

  const outstanding = realLoan ? realLoan.totalRepayment - realLoan.amountRepaid : BigInt(0)

  // Estimated interest/principal split for the repayment input.
  // Mirrors the contract's "interest first, then principal" rule (loans.rs);
  // stated as an estimate since the exact on-chain split is computed inside
  // the contract's repay_loan_partial handler and may drift if its formula
  // changes. All bigint, never float.
  const totalInterest = realLoan ? realLoan.totalRepayment - realLoan.principal : BigInt(0)
  const interestPaid = realLoan
    ? (realLoan.amountRepaid <= totalInterest ? realLoan.amountRepaid : totalInterest)
    : BigInt(0)
  const outstandingInterest = totalInterest - interestPaid
  const parsedRepayAmountForSplit = (() => {
    const t = repayAmount.trim()
    if (!t || isNaN(Number(t))) return null
    const v = parseToken(t)
    // parseToken returns 0n for invalid; but we already checked NaN, so 0n here is truly zero
    return v
  })()
  const isRepayAmountValidForSplit =
    parsedRepayAmountForSplit !== null &&
    parsedRepayAmountForSplit > BigInt(0) &&
    parsedRepayAmountForSplit <= outstanding
  const interestPortion =
    isRepayAmountValidForSplit && parsedRepayAmountForSplit !== null
      ? (parsedRepayAmountForSplit <= outstandingInterest
          ? parsedRepayAmountForSplit
          : outstandingInterest)
      : BigInt(0)
  const principalPortion =
    isRepayAmountValidForSplit && parsedRepayAmountForSplit !== null
      ? parsedRepayAmountForSplit - interestPortion
      : BigInt(0)

  const votingProgress = calculatePercentage(proposal.votesFor, proposal.votesFor + proposal.votesAgainst)
  const totalVotes = proposal.votesFor + proposal.votesAgainst
  // Approximates participation against active member headcount (vote
  // weight can exceed 1/member via staking bonuses, so this can overshoot
  // 100% for a heavily-staked electorate — clamped below for the bar width).
  const quorumProgress = calculatePercentage(totalVotes, activeMembers)

  return (
    <>
      <PageHeader
        title={`Loan Proposal #${proposal.id}`}
        actions={
          <div className={`px-3 py-1 rounded-full border text-sm font-medium ${getStatusColor(proposal.status)}`}>
            <div className="flex items-center space-x-1">
              {getStatusIcon(proposal.status)}
              <span>{PROPOSAL_STATUS_LABELS[proposal.status as keyof typeof PROPOSAL_STATUS_LABELS]}</span>
            </div>
          </div>
        }
      />
      <div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Loan Overview */}
            <Card>
              <CardHeader>
                <CardTitle>Loan Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
                    <CurrencyDollarIcon className="h-8 w-8 text-blue-600 dark:text-blue-400 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Amount</p>
                    <p className="text-xl font-bold text-foreground">{formatToken(proposal.amount)}</p>
                  </div>
                  <div className="text-center p-4 bg-purple-50 dark:bg-purple-950/30 rounded-lg">
                    <ChartBarIcon className="h-8 w-8 text-purple-600 dark:text-purple-400 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Interest Rate</p>
                    <p className="text-xl font-bold text-foreground">{(proposal.interestRate / 100).toFixed(2)}%</p>
                  </div>
                  <div className="text-center p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
                    <HandThumbUpIcon className="h-8 w-8 text-green-600 dark:text-green-400 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Votes For</p>
                    <p className="text-xl font-bold text-green-600 dark:text-green-400">{proposal.votesFor}</p>
                  </div>
                  <div className="text-center p-4 bg-red-50 dark:bg-red-950/30 rounded-lg">
                    <HandThumbDownIcon className="h-8 w-8 text-red-600 dark:text-red-400 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Votes Against</p>
                    <p className="text-xl font-bold text-red-600 dark:text-red-400">{proposal.votesAgainst}</p>
                  </div>
                </div>

                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Borrower</span>
                  <AddressLink address={proposal.borrower} className="font-medium text-foreground" />
                </div>

                {/* Voting Progress */}
                {proposal.status === 2 && (
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between text-sm text-muted-foreground mb-2">
                        <span>Approval Progress</span>
                        <span>{votingProgress}% in favor</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-3">
                        <div
                          className="bg-green-500 h-3 rounded-full transition-all"
                          style={{ width: `${votingProgress}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between text-sm text-muted-foreground mb-2">
                        <span>Quorum Progress</span>
                        <span>{quorumProgress}% participation</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${Math.min(quorumProgress, 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-sm text-muted-foreground">
                      <span>
                        Voting ends in:{' '}
                        {now === null
                          ? '…'
                          : `${Math.ceil((proposal.votingEndTime - Math.floor(now / 1000)) / 86400)} days`}
                      </span>
                      <span>Total votes: {totalVotes}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <ProposalTimeline
              kind="loan"
              id={loanId}
              isPrivate={proposal.isPrivate}
              fallbackDates={{
                created: proposal.createdAt,
                votingStart: proposal.votingStartTime,
                votingEnd: proposal.votingEndTime,
              }}
            />

            <DocumentHistory kind="loan" proposalId={loanId} />

            {/* Voting Actions */}
            {canVote() && (
              <Card>
                <CardHeader>
                  <CardTitle>Cast Your Vote</CardTitle>
                  <CardDescription>
                    As a DAO member, you can vote on this loan proposal
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex space-x-4">
                    <Button
                      onClick={() => handleVote(true)}
                      disabled={isVoting || isPaused}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                    >
                      <HandThumbUpIcon className="h-4 w-4 mr-2" />
                      {isVoting ? 'Voting...' : 'Vote For'}
                    </Button>
                    <Button
                      onClick={() => handleVote(false)}
                      disabled={isVoting || isPaused}
                      variant="outline"
                      className="flex-1 text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/30"
                    >
                      <HandThumbDownIcon className="h-4 w-4 mr-2" />
                      {isVoting ? 'Voting...' : 'Vote Against'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {alreadyVoted && (
              <Card>
                <CardContent className="flex items-center gap-3 p-6">
                  <CheckCircleIcon className="h-6 w-6 shrink-0 text-green-500 dark:text-green-400" />
                  <p className="text-sm text-muted-foreground">
                    You&apos;ve already voted on this proposal. A member can only vote once, so the
                    controls are disabled.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Approved by vote but the treasury can't cover it yet */}
            {proposal.status === PROPOSAL_STATUS_AWAITING_FUNDS && (
              <Card role="status" className="border-amber-300 dark:border-amber-900">
                <CardHeader>
                  <CardTitle>Approved — awaiting treasury funds</CardTitle>
                  <CardDescription>
                    Members voted to approve this loan, but the treasury balance is too low to
                    disburse {formatToken(proposal.amount)} right now. It will be paid out once the
                    treasury is topped up and the loan is disbursed.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild variant="outline">
                    <Link href="/treasury">Go to Treasury</Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Real disbursed-loan status, once approved */}
            {proposal.status === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle>Loan Status</CardTitle>
                  <CardDescription>
                    The disbursed loan&apos;s real on-chain state — separate from
                    the proposal above, which only tracked the vote.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {loanLoading || !realLoan ? (
                    <div className="skeleton h-24 w-full rounded-lg" />
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <span className={`px-3 py-1 rounded-full border text-sm font-medium ${loanStatusClass(realLoan.status)}`}>
                          {realLoan.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Principal</p>
                          <p className="font-medium text-foreground">{formatToken(realLoan.principal)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Total Repayment</p>
                          <p className="font-medium text-foreground">{formatToken(realLoan.totalRepayment)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Repaid So Far</p>
                          <p className="font-medium text-foreground">{formatToken(realLoan.amountRepaid)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Due</p>
                          <p className={`font-medium ${isOverdue ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>
                            {formatDate(realLoan.dueTime)}
                          </p>
                        </div>
                      </div>

                      {isOverdue && (
                        <div className="pt-4 border-t border-border">
                          <div className="flex items-start gap-2 mb-3">
                            <ExclamationTriangleIcon className="h-5 w-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
                            <p className="text-sm text-foreground">
                              This loan is past its due date. Anyone can mark
                              it defaulted, which slashes a policy-defined
                              share of the borrower&apos;s treasury claim.
                            </p>
                          </div>
                          <Button
                            onClick={handleMarkDefaulted}
                            disabled={isMarkingDefaulted || isPaused}
                            variant="outline"
                            className="w-full text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/30"
                          >
                            {isMarkingDefaulted ? 'Processing...' : 'Mark as Defaulted'}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Loan Repayment for Borrower */}
            {isBorrower() && realLoan?.status === 'Active' && (
              <Card>
                <CardHeader>
                  <CardTitle>Loan Repayment</CardTitle>
                  <CardDescription>
                    Enter an amount up to the outstanding balance. Interest is
                    paid first, then principal — the interest portion is
                    distributed to active members as yield immediately.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <span className="text-sm text-muted-foreground">Outstanding balance</span>
                    <span className="text-lg font-semibold text-foreground">{formatToken(outstanding)}</span>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="repay-amount" className="block text-sm font-medium text-foreground">
                      Repayment amount
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="repay-amount"
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={repayAmount}
                        onChange={(e) => {
                          setRepayAmount(e.target.value)
                          if (repayError) setRepayError(null)
                        }}
                        className="flex-1 rounded-lg border border-input px-3 py-2 text-sm transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setRepayAmount(formatToken(outstanding, { displayDecimals: 7 }))
                          setRepayError(null)
                        }}
                      >
                        Max
                      </Button>
                    </div>
                    {repayError && (
                      <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                        {repayError}
                      </p>
                    )}
                  </div>
                  {isRepayAmountValidForSplit && parsedRepayAmountForSplit !== null && (
                    <div className="rounded-lg border border-border p-3 space-y-2 bg-blue-50/50 dark:bg-blue-950/20">
                      <p className="text-sm font-medium text-foreground">Estimated split (interest first)</p>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Interest</span>
                        <span className="font-medium text-foreground">{formatToken(interestPortion)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Principal</span>
                        <span className="font-medium text-foreground">{formatToken(principalPortion)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Estimate — exact split is computed on-chain.</p>
                      <div className="flex justify-between text-sm pt-2 border-t border-border">
                        <span className="text-muted-foreground">Remaining balance after</span>
                        <span className="font-medium text-foreground">{formatToken(outstanding - parsedRepayAmountForSplit)}</span>
                      </div>
                    </div>
                  )}
                  <Button onClick={handleRepayment} disabled={isRepaying} className="w-full">
                    {isRepaying
                      ? 'Processing...'
                      : parsedRepayAmountForSplit === outstanding
                        ? 'Repay Full Outstanding Balance'
                        : 'Repay'}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Supporting document (on-chain content hash) */}
            <Card>
              <CardHeader>
                <CardTitle>Supporting Document</CardTitle>
                <CardDescription>
                  A content hash (e.g. an IPFS CID) anchoring an off-chain
                  document to this proposal.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {documentCid ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <DocumentTextIcon className="h-8 w-8 shrink-0 text-primary-600" />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">Attached document</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {documentCid}
                        </p>
                      </div>
                    </div>
                    {IPFS_GATEWAY && <a
                      href={`${IPFS_GATEWAY}${documentCid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm">
                        <EyeIcon className="mr-2 h-4 w-4" />
                        View
                      </Button>
                    </a>}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">No document attached yet.</p>
                    {userData.isMember && (
                      <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          value={cidInput}
                          onChange={(e) => setCidInput(e.target.value)}
                          placeholder="IPFS CID or content hash…"
                          spellCheck={false}
                          aria-invalid={cidInput.trim().length > 0 && !isCidValid}
                          className={`w-full rounded-lg border px-3 py-2 font-mono text-sm transition-colors focus:outline-none focus:ring-2 ${
                            cidInput.trim().length > 0 && !isCidValid
                              ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
                              : 'border-input focus:border-primary-500 focus:ring-primary-500/20'
                          }`}
                        />
                        {cidInput.trim().length > 0 && !isCidValid && (
                          <p className="text-xs text-destructive">Must be a valid CIDv0 (Qm…) or CIDv1 (b…) IPFS content identifier</p>
                        )}
                        </div>
                        <Button
                          size="sm"
                          disabled={attaching || !isCidValid || isPaused}
                          onClick={async () => {
                            try {
                              await attach('Loan', loanId, cidInput)
                              setCidInput('')
                              refetchDocument()
                            } catch {
                              /* toast handled in hook */
                            }
                          }}
                        >
                          Attach
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <ProposalTimeline
              kind="loan"
              id={loanId}
              isPrivate={proposal.isPrivate}
              fallbackDates={{
                created: proposal.createdAt,
                votingStart: proposal.votingStartTime,
                votingEnd: proposal.votingEndTime,
              }}
            />

            <DocumentHistory kind="loan" proposalId={loanId} />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Proposal Timeline */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <CalendarIcon className="h-5 w-5 mr-2" />
                  Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">{formatDate(proposal.creationTime)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Editing Ended</span>
                  <span className="font-medium">{formatDate(proposal.votingStartTime)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Voting Ends</span>
                  <span className="font-medium">{formatDate(proposal.votingEndTime)}</span>
                </div>
                {realLoan && (
                  <>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Disbursed</span>
                      <span className="font-medium">{formatDate(realLoan.startTime)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Due</span>
                      <span className={`font-medium ${isOverdue ? 'text-red-600 dark:text-red-400' : ''}`}>
                        {formatDate(realLoan.dueTime)}
                      </span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}

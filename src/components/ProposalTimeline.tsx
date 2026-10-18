'use client'

import { useLoanTimeline, useTreasuryTimeline, eventLabel } from '@/hooks/useDAO'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { CalendarIcon, Clock, CheckCircle, ExternalLink } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface ProposalTimelineProps {
  kind: 'loan' | 'treasury'
  id: number
  isPrivate?: boolean
  fallbackDates?: {
    created?: number | string
    votingStart?: number | string
    votingEnd?: number | string
    disbursed?: number | string
  }
}

import { useMemo } from 'react'
import { AddressLink } from '@/components/AddressLink'

export function ProposalTimeline({ kind, id, isPrivate = false, fallbackDates }: ProposalTimelineProps) {
  const loanTimeline = useLoanTimeline(kind === 'loan' ? id : 0)
  const treasuryTimeline = useTreasuryTimeline(kind === 'treasury' ? id : 0)

  const { timeline, isLoading } = kind === 'loan' ? loanTimeline : treasuryTimeline

  // useMemo must be called unconditionally (rules-of-hooks). It handles the
  // !timeline case itself, so it is safe to place before the isLoading guard.
  const votes = useMemo(() => {
    if (!timeline) return []
    return timeline
      .filter((ev) => ev.symbol === 'loan_vote' || ev.symbol === 'tre_vote' || ev.symbol === 'committed')
      .map((ev) => {
        let voter = ''
        let support: boolean | null = null
        let weight: number | undefined

        if (Array.isArray(ev.topics) && ev.topics.length >= 3) {
          voter = String(ev.topics[2] ?? '')
        }
        if (ev.data && typeof ev.data === 'object' && !Array.isArray(ev.data)) {
          const d = ev.data as Record<string, unknown>
          if (d.voter) voter = String(d.voter)
          if (typeof d.support === 'boolean') support = d.support
          if (typeof d.weight === 'number') weight = d.weight
        } else if (Array.isArray(ev.data)) {
          if (typeof ev.data[0] === 'boolean') support = ev.data[0]
          if (typeof ev.data[1] === 'number') weight = ev.data[1]
        } else if (typeof ev.data === 'boolean') {
          support = ev.data
        }

        if (ev.symbol === 'committed' || isPrivate) {
          support = null
        }

        return {
          voter: voter || 'Anonymous / Member',
          support,
          weight,
          ledger: ev.ledger,
          createdAt: ev.created_at,
          isCommitment: ev.symbol === 'committed' || isPrivate,
        }
      })
  }, [timeline, isPrivate])

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center text-lg">
            <CalendarIcon className="h-5 w-5 mr-2" />
            Proposal Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading timeline events...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center text-lg">
          <CalendarIcon className="h-5 w-5 mr-2" />
          Proposal Timeline
        </CardTitle>
        <CardDescription>Decoded on-chain event sequence</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {timeline && timeline.length > 0 ? (
          <div className="relative border-l border-border ml-3 pl-4 space-y-4">
            {timeline.map((ev, idx) => (
              <div key={`${ev.symbol}-${ev.ledger}-${idx}`} className="relative">
                <span className="absolute -left-[23px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30">
                  <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                </span>
                <div className="flex flex-col">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">
                      {eventLabel(ev.symbol)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Ledger {ev.ledger}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(ev.created_at)}
                  </span>
                  {ev.tx_hash && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${ev.tx_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
                    >
                      Tx {ev.tx_hash.slice(0, 8)}... <ExternalLink className="ml-1 h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : fallbackDates ? (
          <div className="space-y-3">
            {fallbackDates.created && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Created</span>
                <span className="font-medium">{formatDate(fallbackDates.created)}</span>
              </div>
            )}
            {fallbackDates.votingStart && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Voting Started</span>
                <span className="font-medium">{formatDate(fallbackDates.votingStart)}</span>
              </div>
            )}
            {fallbackDates.votingEnd && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Voting Ends</span>
                <span className="font-medium">{formatDate(fallbackDates.votingEnd)}</span>
              </div>
            )}
            {fallbackDates.disbursed && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Disbursed</span>
                <span className="font-medium">{formatDate(fallbackDates.disbursed)}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No timeline events recorded yet.</p>
        )}

        {/* Voter Breakdown (Issue #402) */}
        <div className="mt-6 border-t border-border pt-4">
          <h4 className="mb-2 text-sm font-semibold text-foreground">Voter Breakdown</h4>
          {isPrivate ? (
            <p className="text-xs text-muted-foreground">
              Private proposal — individual choices are confidential ({votes.length} commitment{votes.length === 1 ? '' : 's'} recorded).
            </p>
          ) : votes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No individual voter records available.</p>
          ) : (
            <div className="space-y-2">
              {votes.map((v, i) => (
                <div
                  key={`${v.voter}-${i}`}
                  className="flex items-center justify-between rounded-lg bg-muted/40 p-2 text-xs"
                >
                  <AddressLink address={v.voter} className="text-foreground" />
                  <div className="flex items-center gap-2">
                    {v.weight !== undefined && (
                      <span className="text-muted-foreground">weight: {v.weight}</span>
                    )}
                    {v.support === true && (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400">
                        Voted For
                      </span>
                    )}
                    {v.support === false && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800 dark:bg-red-950/50 dark:text-red-400">
                        Voted Against
                      </span>
                    )}
                    {v.support === null && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                        Commitment
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

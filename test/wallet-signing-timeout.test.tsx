// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { WalletProvider } from '@/lib/wallet'
import { useWriteAction } from '@/hooks/dao/writes'
import * as freighter from '@stellar/freighter-api'

vi.mock('@stellar/freighter-api', () => ({
  isAllowed: vi.fn().mockResolvedValue({ isAllowed: true }),
  requestAccess: vi.fn(),
  getAddress: vi.fn().mockResolvedValue({ address: 'ACCOUNT_SIGNER' }),
  getNetwork: vi.fn().mockResolvedValue({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' }),
  signTransaction: vi.fn(),
  isConnected: vi.fn().mockResolvedValue({ isConnected: true, version: '2.5.0' }),
  WatchWalletChanges: vi.fn().mockImplementation(function () {
    return { watch: vi.fn(), stop: vi.fn() }
  }),
}))

vi.mock('@/lib/stellar', () => ({
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  getTransactionUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`
}))

vi.mock('@/lib/dao-client', () => ({
  daoWrite: vi.fn().mockImplementation((addr, signer) => ({
    registerMember: async () => {
      await signer('XDR_TX')
      return { hash: '0x123', returnValue: null }
    }
  })),
  InvokeError: class InvokeError extends Error {
    retryable = true
  },
  // A submission window that closed without a confirmation is a distinct,
  // non-retryable outcome (#309) — useWriteAction branches on it.
  TransactionPendingError: class TransactionPendingError extends Error {
    hash = '0x123'
    url: string | null = null
    retryable = false
  },
  watchTransaction: vi.fn().mockResolvedValue('timeout'),
}))

function TestWriteHarness({ onRender }: { onRender: (w: ReturnType<typeof useWriteAction>) => void }) {
  const write = useWriteAction()
  onRender(write)
  return null
}

function renderWriteProvider(queryClient: QueryClient, onRender: (w: ReturnType<typeof useWriteAction>) => void) {
  return render(
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <TestWriteHarness onRender={onRender} />
      </WalletProvider>
    </QueryClientProvider>
  )
}

describe('Issue #221 — Bounded signature request & cancellation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'ACCOUNT_SIGNER' } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('times out when signature request never resolves', async () => {
    // Return a promise that never resolves
    vi.mocked(freighter.signTransaction).mockReturnValue(new Promise(() => {}))

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let writeHook: ReturnType<typeof useWriteAction> | undefined

    renderWriteProvider(qc, (w) => { writeHook = w })

    await waitFor(() => expect(writeHook?.address).toBe('ACCOUNT_SIGNER'))

    let actionPromise: Promise<unknown> | undefined
    act(() => {
      actionPromise = writeHook!.run('Testing', (w) => w.registerMember())
    })

    expect(writeHook?.isPending).toBe(true)

    // Attach handler before advancing timers to avoid unhandled rejection in act
    const assertion = expect(actionPromise).rejects.toThrow(/timed out/)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61000)
    })

    await assertion
    expect(writeHook?.isPending).toBe(false)
    expect(writeHook?.isRetryable).toBe(true)
  })

  it('restores UI cleanly when member cancels pending signature', async () => {
    vi.mocked(freighter.signTransaction).mockReturnValue(new Promise(() => {}))

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let writeHook: ReturnType<typeof useWriteAction> | undefined

    renderWriteProvider(qc, (w) => { writeHook = w })

    await waitFor(() => expect(writeHook?.address).toBe('ACCOUNT_SIGNER'))

    let actionPromise: Promise<unknown> | undefined
    act(() => {
      actionPromise = writeHook!.run('Testing Cancel', (w) => w.registerMember())
    })

    expect(writeHook?.isPending).toBe(true)

    act(() => {
      writeHook!.cancelSignature()
    })

    await expect(actionPromise).rejects.toThrow(/cancelled/)
    expect(writeHook?.isPending).toBe(false)
    expect(writeHook?.isRetryable).toBe(true)
  })
});

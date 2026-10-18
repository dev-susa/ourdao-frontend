// @vitest-environment jsdom
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Providers } from '@/components/providers'
import { LiveAnnouncer } from '@/components/LiveAnnouncer'
import { announce } from '@/lib/announce'
import { useAnnounceLoad } from '@/lib/useAnnounceLoad'
import { useWriteAction } from '@/hooks/dao/writes'

// #233: status that is only visual (toasts, skeleton -> rows) is invisible to
// a screen-reader user. These tests pin the announcement contract.

const mockSignXDR = vi.fn()
vi.mock('@/lib/wallet', () => ({
  WalletProvider: ({ children }: { children: React.ReactNode }) => children,
  useWallet: () => ({
    address: 'GALICE',
    isConnected: true,
    signXDR: mockSignXDR,
  }),
}))

vi.mock('@/lib/stellar', () => ({
  getTransactionUrl: (hash: string) => `https://explorer.test/tx/${hash}`,
}))

let mockWrite: () => Promise<{ hash: string; returnValue: null }>
vi.mock('@/lib/dao-client', () => ({
  daoWrite: () => ({ doThing: () => mockWrite() }),
  InvokeError: class InvokeError extends Error {
    retryable = false
  },
  // A submission window that closed without a confirmation is a distinct,
  // non-retryable outcome (#309) — useWriteAction branches on it.
  TransactionPendingError: class TransactionPendingError extends Error {
    hash = 'h'
    url: string | null = null
    retryable = false
  },
  watchTransaction: vi.fn().mockResolvedValue('timeout'),
}))

const polite = () => screen.getByTestId('live-polite')
const assertive = () => screen.getByTestId('live-assertive')

const harness: { run: ReturnType<typeof useWriteAction>['run'] } = { run: undefined as never }
const runWrite: ReturnType<typeof useWriteAction>['run'] = (...a) => harness.run(...a)
function WriteHarness() {
  const { run } = useWriteAction()
  useEffect(() => {
    harness.run = run
  })
  return null
}

function renderApp() {
  return render(
    <Providers>
      <WriteHarness />
    </Providers>
  )
}

describe('LiveAnnouncer', () => {
  it('renders a polite status region and an assertive alert region up front', () => {
    render(<LiveAnnouncer />)
    expect(polite()).toHaveAttribute('role', 'status')
    expect(polite()).toHaveAttribute('aria-live', 'polite')
    expect(assertive()).toHaveAttribute('role', 'alert')
    expect(assertive()).toHaveAttribute('aria-live', 'assertive')
  })

  it('routes polite messages to the status region and assertive ones to the alert region', () => {
    render(<LiveAnnouncer />)
    act(() => announce('Saved.'))
    act(() => announce('Save failed.', 'assertive'))
    expect(polite()).toHaveTextContent('Saved.')
    expect(polite()).not.toHaveTextContent('Save failed.')
    expect(assertive()).toHaveTextContent('Save failed.')
  })

  it('re-announces an identical message by mounting a fresh node', () => {
    render(<LiveAnnouncer />)
    act(() => announce('Same.'))
    const first = polite().firstChild
    act(() => announce('Same.'))
    expect(polite().firstChild).not.toBe(first)
  })
})

describe('write status is announced, not only toasted', () => {
  beforeEach(() => {
    mockSignXDR.mockReset()
  })
  afterEach(() => {
    toast.remove()
  })

  it('announces progress politely, then confirmation politely', async () => {
    let finish!: (v: { hash: string; returnValue: null }) => void
    mockWrite = () => new Promise((resolve) => (finish = resolve))
    renderApp()

    let done!: Promise<unknown>
    act(() => {
      done = runWrite('Join DAO', (w) => (w as never as { doThing: () => Promise<never> }).doThing())
    })
    await waitFor(() => expect(polite()).toHaveTextContent('Join DAO in progress.'))
    expect(assertive()).toBeEmptyDOMElement()

    await act(async () => {
      finish({ hash: 'abc', returnValue: null })
      await done
    })
    expect(polite()).toHaveTextContent('Join DAO confirmed.')
    expect(assertive()).toBeEmptyDOMElement()
  })

  it('announces a failure assertively so it interrupts', async () => {
    mockWrite = () => Promise.reject(new Error('boom'))
    renderApp()

    await act(async () => {
      await runWrite('Join DAO', (w) => (w as never as { doThing: () => Promise<never> }).doThing()).catch(() => {})
    })
    expect(assertive()).toHaveTextContent('Join DAO failed: boom')
    // Progress text was polite; the failure must not have been queued there.
    expect(polite()).not.toHaveTextContent('failed')
  })

  it('does not duplicate: toasts are silenced, so the announcer is the only live voice', async () => {
    let finish!: (v: { hash: string; returnValue: null }) => void
    mockWrite = () => new Promise((resolve) => (finish = resolve))
    const { container } = renderApp()

    let done!: Promise<unknown>
    act(() => {
      done = runWrite('Join DAO', (w) => (w as never as { doThing: () => Promise<never> }).doThing())
    })
    await waitFor(() => expect(document.body).toHaveTextContent('Join DAO…'))
    await act(async () => {
      finish({ hash: 'abc', returnValue: null })
      await done
    })

    // The toast updated in place (one element, by id) and is not itself live.
    const toastNodes = Array.from(document.body.querySelectorAll('[role="status"]')).filter(
      (n) => n.getAttribute('data-testid') !== 'live-polite'
    )
    expect(toastNodes).toHaveLength(1)
    expect(toastNodes[0]).toHaveAttribute('aria-live', 'off')

    // Exactly one polite live region and one assertive one in the whole page.
    expect(document.body.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
    expect(document.body.querySelectorAll('[aria-live="assertive"]')).toHaveLength(1)
    void container
  })
})

describe('useAnnounceLoad', () => {
  function View({ loading, error = false }: { loading: boolean; error?: boolean }) {
    useAnnounceLoad('Loan proposals', loading, error)
    return null
  }
  function renderView(loading: boolean, error = false) {
    const client = new QueryClient()
    const tree = (l: boolean, e: boolean) => (
      <QueryClientProvider client={client}>
        <LiveAnnouncer />
        <View loading={l} error={e} />
      </QueryClientProvider>
    )
    const utils = render(tree(loading, error))
    return { ...utils, next: (l: boolean, e = false) => utils.rerender(tree(l, e)) }
  }

  it('announces loading -> loaded once, politely', () => {
    const { next } = renderView(true)
    expect(polite()).toBeEmptyDOMElement()
    next(false)
    expect(polite()).toHaveTextContent('Loan proposals loaded.')
  })

  it('announces loading -> failed assertively, and never claims it loaded', () => {
    const { next } = renderView(true)
    next(false, true)
    expect(assertive()).toHaveTextContent('Loan proposals failed to load.')
    expect(polite()).toBeEmptyDOMElement()
  })

  it('stays quiet for a view that was already loaded on mount', () => {
    renderView(false)
    expect(polite()).toBeEmptyDOMElement()
    expect(assertive()).toBeEmptyDOMElement()
  })
})

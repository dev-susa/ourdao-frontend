// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import React, { type ReactNode } from 'react'
import { createQueryClient } from '@/components/providers'
import AppError from '@/app/(app)/error'
import { LoadError } from '@/components/LoadError'
import { BackendError } from '@/lib/backend'

// #230: a failed query must reach an error boundary (primary data) or render
// an explicit "failed to load" (secondary data) — never an empty state.

class Boundary extends React.Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return <AppError error={this.state.error} reset={() => this.setState({ error: null })} />
    }
    return this.props.children
  }
}

function Primary({ fn }: { fn: () => Promise<string[]> }) {
  const { data } = useQuery({ queryKey: ['primary'], queryFn: fn, meta: { boundary: true } })
  return <p>{data?.length === 0 ? 'Nothing here' : `Rows: ${data?.join(',') ?? '…'}`}</p>
}

function Secondary({ fn }: { fn: () => Promise<string[]> }) {
  const { data, isError } = useQuery({ queryKey: ['secondary'], queryFn: fn })
  if (isError) return <LoadError what="the widget" />
  return <p>{data?.length === 0 ? 'Nothing here' : `Rows: ${data?.join(',') ?? '…'}`}</p>
}

function renderWithClient(ui: ReactNode) {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <Boundary>{ui}</Boundary>
    </QueryClientProvider>
  )
}

describe('central throwOnError policy', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends a failed primary (meta.boundary) query to the error boundary', async () => {
    renderWithClient(<Primary fn={() => Promise.reject(new Error('rpc down'))} />)
    expect(await screen.findByRole('alert')).toHaveTextContent("This page couldn't load")
    expect(screen.getByText('rpc down')).toBeInTheDocument()
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument()
  })

  it('renders a reference ID and hides raw error details like RPC URLs in production', async () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      renderWithClient(
        <Primary fn={() => Promise.reject(new Error('Simulation failed against https://soroban-testnet.stellar.org: tx 123'))} />
      )
      expect(await screen.findByRole('alert')).toHaveTextContent("This page couldn't load")
      expect(screen.getByTestId('error-reference-id')).toHaveTextContent(/Reference: ERR_/)
      expect(screen.queryByText(/https:\/\/soroban-testnet\.stellar\.org/)).not.toBeInTheDocument()
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })

  it('lets a failed secondary query degrade in place without tripping the boundary', async () => {
    renderWithClient(
      <>
        <h1>Page</h1>
        <Secondary fn={() => Promise.reject(new Error('indexer down'))} />
      </>
    )
    expect(await screen.findByTestId('load-error')).toHaveTextContent("Couldn't load the widget")
    // The rest of the page is still rendered; the boundary did not replace it.
    expect(screen.getByRole('heading', { name: 'Page' })).toBeInTheDocument()
    expect(screen.queryByText("This page couldn't load")).not.toBeInTheDocument()
  })

  it('never renders a failure as an empty state, in either case', async () => {
    renderWithClient(<Secondary fn={() => Promise.reject(new Error('x'))} />)
    await screen.findByTestId('load-error')
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument()
  })

  it('still shows a genuinely empty result as empty', async () => {
    renderWithClient(<Secondary fn={() => Promise.resolve([])} />)
    expect(await screen.findByText('Nothing here')).toBeInTheDocument()
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument()
  })

  it('treats a rejecting BackendError like any other failure', async () => {
    renderWithClient(<Secondary fn={() => Promise.reject(new BackendError('down', 503))} />)
    expect(await screen.findByTestId('load-error')).toBeInTheDocument()
  })
})

describe('boundary recovery without a reload', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('"Try again" refetches the failed query and recovers', async () => {
    const fn = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValue(['a', 'b'])
    renderWithClient(<Primary fn={fn} />)

    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.getByText('Rows: a,b')).toBeInTheDocument())
    expect(fn).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers a way back to the dashboard from the boundary', async () => {
    renderWithClient(<Primary fn={() => Promise.reject(new Error('nope'))} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '/dashboard')
  })
})

describe('LoadError', () => {
  it('is an assertive alert that says it is a loading problem, and offers retry', async () => {
    const onRetry = vi.fn()
    render(<LoadError what="loan proposals" onRetry={onRetry} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load loan proposals.")
    expect(alert).toHaveTextContent('not an empty list')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

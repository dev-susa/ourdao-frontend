// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AppShell } from '@/components/AppShell'
import { SkipLink } from '@/components/SkipLink'
import { MAIN_CONTENT_ID } from '@/lib/a11y'

// #232 (WCAG 2.4.1 Bypass Blocks): a keyboard user must be able to skip the
// header and navigation, and a client-side navigation must move focus.

let mockPathname = '/dashboard'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: null,
    isConnected: false,
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signXDR: vi.fn(),
    networkMismatch: false,
    walletNetwork: null,
  }),
}))

vi.mock('@/lib/stellar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar')>('@/lib/stellar')
  return { ...actual, isContractConfigured: () => true }
})

vi.mock('@/lib/dao-client', () => ({
  daoRead: {},
  daoWrite: () => ({}),
}))

vi.mock('@/lib/backend', () => ({
  backend: {
    getLoans: vi.fn().mockResolvedValue([]),
    getNotifications: vi.fn().mockResolvedValue([]),
    getEvents: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue(null),
    getAdminLog: vi.fn().mockResolvedValue([]),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}))

function Page({ heading }: { heading: string }) {
  return (
    <div>
      <h1>{heading}</h1>
      <button type="button">Page action</button>
    </div>
  )
}

function renderShell(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (c: ReactNode) => (
    <QueryClientProvider client={client}>
      <SkipLink />
      <AppShell>{c}</AppShell>
    </QueryClientProvider>
  )
  const utils = render(wrap(children))
  return { ...utils, rerenderShell: (c: ReactNode) => utils.rerender(wrap(c)) }
}

describe('skip link', () => {
  beforeEach(() => {
    mockPathname = '/dashboard'
  })

  it('is the first focusable element on the page', async () => {
    renderShell(<Page heading="Dashboard" />)
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus()
  })

  it('targets a <main> landmark that carries the matching id', () => {
    renderShell(<Page heading="Dashboard" />)
    const link = screen.getByRole('link', { name: 'Skip to main content' })
    expect(link).toHaveAttribute('href', `#${MAIN_CONTENT_ID}`)
    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', MAIN_CONTENT_ID)
    expect(main).toHaveAttribute('tabindex', '-1')
  })

  it('is visually hidden until focused', () => {
    renderShell(<Page heading="Dashboard" />)
    const link = screen.getByRole('link', { name: 'Skip to main content' })
    expect(link.className).toContain('sr-only')
    expect(link.className).toContain('focus:not-sr-only')
  })

  it('moves focus into <main> when activated from the keyboard', async () => {
    renderShell(<Page heading="Dashboard" />)
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
    // The very next Tab lands on content inside main, not back in the nav.
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Page action' })).toHaveFocus()
  })
})

describe('focus on client-side navigation', () => {
  beforeEach(() => {
    mockPathname = '/dashboard'
  })

  it('leaves focus alone on the first render', () => {
    renderShell(<Page heading="Dashboard" />)
    expect(document.body).toHaveFocus()
  })

  it('moves focus to the new page heading when the route changes', async () => {
    const { rerenderShell } = renderShell(<Page heading="Dashboard" />)
    mockPathname = '/loans'
    rerenderShell(<Page heading="Loans" />)
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Loans' })).toHaveFocus())
  })

  it('falls back to <main> when the new page has no heading', async () => {
    const { rerenderShell } = renderShell(<Page heading="Dashboard" />)
    mockPathname = '/treasury'
    rerenderShell(<p>No heading here</p>)
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
  })

  it('does not steal focus on a re-render that keeps the same route', async () => {
    const { rerenderShell } = renderShell(<Page heading="Dashboard" />)
    const button = screen.getByRole('button', { name: 'Page action' })
    button.focus()
    rerenderShell(<Page heading="Dashboard" />)
    expect(button).toHaveFocus()
  })
})

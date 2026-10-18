// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { renderWithProviders } from './test-utils'
import { AppShell } from '@/components/AppShell'
import DocumentUpload from '@/components/DocumentUpload'
import RegisterPage from '@/app/register/page'
import CreateProposalPage from '@/app/(app)/governance/create/page'
import RequestLoanPage from '@/app/(app)/loans/request/page'

// #231: every interactive element needs an accessible name. This is the
// runtime half of the guard (the lint rules in eslint.config.mjs are the
// static half): it runs axe-core's naming rules over rendered components, so a
// control whose name only exists in source (or is lost by a refactor) fails.

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/lib/wallet', () => ({
  useWallet: () => ({
    address: 'GALICE',
    isConnected: true,
    connecting: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    signXDR: vi.fn(),
    networkMismatch: false,
    walletNetwork: 'TESTNET',
  }),
}))

vi.mock('@/lib/stellar', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stellar')>('@/lib/stellar')
  return { ...actual, isContractConfigured: () => true }
})

vi.mock('@/lib/dao-client', () => {
  const resolve = (v: unknown) => () => Promise.resolve(v)
  return {
    daoRead: {
      isMember: resolve(true),
      isAdmin: resolve(true),
      getMember: resolve({ status: 'ActiveMember', has_active_loan: false }),
      getPendingYield: resolve(BigInt(0)),
      getLoanPolicy: resolve(null),
      getTotalMembers: resolve(1),
      getActiveMembers: resolve(1),
      getConsensusThreshold: resolve(5000),
      getTreasuryBalance: resolve(BigInt(0)),
      isPaused: resolve(false),
    },
    daoWrite: () => ({}),
  }
})

vi.mock('@/lib/backend', async () => {
  const actual = await vi.importActual<typeof import('@/lib/backend')>('@/lib/backend')
  return {
    ...actual,
    backend: {
      getLoans: vi.fn().mockResolvedValue([]),
      getNotifications: vi.fn().mockResolvedValue([]),
      getEvents: vi.fn().mockResolvedValue([]),
      getStats: vi.fn().mockResolvedValue(null),
      getAdminLog: vi.fn().mockResolvedValue([]),
      markNotificationRead: vi.fn(),
      markAllNotificationsRead: vi.fn(),
    },
  }
})

const NAME_RULES = [
  'button-name',
  'link-name',
  'label',
  'select-name',
  'input-button-name',
  'input-image-alt',
  'aria-command-name',
  'aria-input-field-name',
  'aria-toggle-field-name',
]

async function unnamedControls(container: Element): Promise<string[]> {
  const results = await axe.run(container, { runOnly: { type: 'rule', values: NAME_RULES } })
  return results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`))
}

describe('accessible names (axe-core naming rules)', () => {
  it('app shell: header, navigation, theme toggle, notifications, wallet', async () => {
    const { container } = renderWithProviders(
      <AppShell>
        <h1>Page</h1>
      </AppShell>
    )
    await waitFor(() => expect(screen.getByRole('main')).toBeInTheDocument())
    expect(await unnamedControls(container)).toEqual([])
  })

  it('document upload, including the per-file remove control', async () => {
    const { container } = render(<DocumentUpload onUpload={vi.fn()} />)
    expect(await unnamedControls(container)).toEqual([])
  })

  it('register form', async () => {
    const { container } = renderWithProviders(<RegisterPage />)
    await waitFor(() => expect(container.querySelector('main')).not.toBeNull())
    expect(await unnamedControls(container)).toEqual([])
  })

  it('treasury proposal form', async () => {
    const { container } = renderWithProviders(<CreateProposalPage />)
    await waitFor(() => expect(container.querySelector('form, h1')).not.toBeNull())
    expect(await unnamedControls(container)).toEqual([])
  })

  it('loan request form', async () => {
    const { container } = renderWithProviders(<RequestLoanPage />)
    await waitFor(() => expect(container.querySelector('form, h1')).not.toBeNull())
    expect(await unnamedControls(container)).toEqual([])
  })

  it('the check is not vacuous: it reports an icon-only button with no name', async () => {
    const { container } = render(
      // eslint-disable-next-line jsx-a11y/control-has-associated-label -- Deliberately unnamed control to prove the audit catches it.
      <button type="button">
        <svg aria-hidden="true" />
      </button>
    )
    expect((await unnamedControls(container)).join()).toContain('button-name')
  })
})

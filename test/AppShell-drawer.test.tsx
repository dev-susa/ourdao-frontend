// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserData } from '@/types/dao'

// #68: the mobile drawer was a hand-rolled div with no Escape handling, no
// focus trap/restoration, no dialog role, and no scroll lock. These cover
// the behavior now provided by the vendored Radix Sheet primitive.

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

vi.mock('@/hooks/useDAO', () => ({
  useUserData: (): Partial<UserData> => ({ isAdmin: false }),
  useDAOStats: () => ({ indexerStale: false }),
}))

vi.mock('@/lib/stellar', () => ({
  isContractConfigured: () => true,
}))

vi.mock('@/components/ConnectButton', () => ({
  ConnectButton: () => <button type="button">Connect Wallet</button>,
}))

vi.mock('@/components/NetworkBadge', () => ({
  NetworkBadge: () => null,
}))

vi.mock('@/components/NotificationCenter', () => ({
  default: () => <div data-testid="notification-center-stub" />,
}))

vi.mock('@/components/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button" aria-label="Toggle theme" />,
}))

async function renderAppShell() {
  const { AppShell } = await import('@/components/AppShell')
  return render(
    <AppShell>
      <p>Page content</p>
    </AppShell>
  )
}

describe('AppShell mobile drawer', () => {
  afterEach(() => vi.clearAllMocks())

  it('exposes a dialog role with an accessible name once opened', async () => {
    const user = userEvent.setup()
    await renderAppShell()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))

    const dialog = await screen.findByRole('dialog', { name: 'Navigation menu' })
    expect(dialog).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    await renderAppShell()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('traps focus inside the open drawer', async () => {
    const user = userEvent.setup()
    await renderAppShell()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const dialog = await screen.findByRole('dialog')

    // Tab repeatedly — focus must never land on something outside the
    // dialog (e.g. the "Connect Wallet" button in the header behind it).
    for (let i = 0; i < 10; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('returns focus to the hamburger button on close', async () => {
    const user = userEvent.setup()
    await renderAppShell()

    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    await user.click(trigger)
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })
})

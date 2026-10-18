// @vitest-environment jsdom
import { expect, test } from '@playwright/test'
import { gotoInTheme, type Theme } from './helpers'

/**
 * Snapshot matrix for the main routes (#270): every route × {light, dark},
 * run once per viewport project (desktop / mobile) defined in
 * playwright.config.ts.
 *
 * Routes are captured in their wallet-disconnected state — CI has no
 * Freighter extension, and those gates are real UI worth protecting.
 * Deliberately not snapshotted (see docs/visual-tests.md):
 *   - /loans/request redirects to / without a wallet, so it would only ever
 *     picture the landing page;
 *   - /loans/[id] raises a transient "Loan not found" toast on load, which is
 *     not deterministic enough to baseline;
 *   - /governance/create and /admin additionally render Member Only /
 *     Access Denied gates that ARE captured below.
 */
const ROUTES: { name: string; path: string }[] = [
  { name: 'landing', path: '/' },
  { name: 'register', path: '/register' },
  { name: 'dashboard', path: '/dashboard' },
  { name: 'loans', path: '/loans' },
  { name: 'governance', path: '/governance' },
  { name: 'create-proposal', path: '/governance/create' },
  { name: 'treasury', path: '/treasury' },
  { name: 'privacy', path: '/privacy' },
  { name: 'admin', path: '/admin' },
]

const THEMES: Theme[] = ['light', 'dark']

for (const route of ROUTES) {
  for (const theme of THEMES) {
    test(`${route.name} renders in the ${theme} theme`, async ({ page }) => {
      await gotoInTheme(page, route.path, theme)
      await expect(page).toHaveScreenshot(`${route.name}-${theme}.png`)
    })
  }
}

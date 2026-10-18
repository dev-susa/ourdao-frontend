// @vitest-environment jsdom
import { expect, type Page } from '@playwright/test'

export type Theme = 'light' | 'dark'

/**
 * Load `path` in a known theme and hand back a settled page.
 *
 * - Theme: next-themes (`attribute="class"`, default storage key) reads
 *   `localStorage.theme` on boot, so seed it before any app script runs and
 *   mirror `prefers-color-scheme` for anything reading the media query
 *   directly.
 * - Motion: the app collapses all CSS animation under
 *   `prefers-reduced-motion: reduce` (globals.css, #73), so emulating that
 *   media feature makes skeletons, spinners, and transitions render in a
 *   single deterministic state.
 * - Settling: wait for `networkidle` (dev-server HMR polling and late
 *   hydration chunks both count as in-flight requests — this is what fixed
 *   the one flaky route), then fonts, then every loading skeleton leaving
 *   the DOM; `toHaveScreenshot` finally polls for a frame that stops
 *   changing.
 * - Dev chrome: Next.js's dev-tools button/overlay (`<nextjs-portal>`) is
 *   removed from the DOM before capture — it slides in on its own schedule
 *   and would otherwise be the flakiest element in every baseline. It is
 *   dev-only UI that never ships to production.
 */
export async function gotoInTheme(page: Page, path: string, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.addInitScript((value: string) => {
    window.localStorage.setItem('theme', value)
  }, theme)

  await page.goto(path, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle', { timeout: 30_000 })
  await page.evaluate(() => {
    document.fonts.ready.then(() => undefined)
    document.querySelectorAll('nextjs-portal').forEach((el) => el.remove())
  })
  await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 20_000 })
}

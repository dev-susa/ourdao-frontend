// @vitest-environment jsdom
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import { ComponentCatalogue, SECTIONS } from '@/app/dev/components/catalogue'

const primitives = readdirSync(resolve(__dirname, '../src/components/ui'))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => f.replace(/\.tsx$/, ''))
  .sort()

describe('/dev/components catalogue (#253)', () => {
  it('has a section for every file in src/components/ui', () => {
    expect(SECTIONS.map((s) => s.file).sort()).toEqual(primitives)
  })

  it('renders every primitive in both the site theme and a forced dark theme', () => {
    renderWithProviders(<ComponentCatalogue />)

    const site = screen.getByRole('region', { name: 'Site theme' })
    const dark = screen.getByRole('region', { name: 'Dark theme' })
    expect(site).not.toHaveClass('dark')
    expect(dark).toHaveClass('dark')
    for (const panel of [site, dark]) {
      for (const file of primitives) {
        expect(within(panel).getByText(`ui/${file}`)).toBeInTheDocument()
      }
      // Every button variant is shown, not just the default.
      expect(within(panel).getByRole('button', { name: 'destructive lg' })).toBeInTheDocument()
    }
  })
})

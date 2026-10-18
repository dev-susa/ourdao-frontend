// @vitest-environment jsdom
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'

/**
 * Renders a page/component with the providers every real page gets from the
 * root layout (QueryClientProvider, ThemeProvider) minus WalletProvider —
 * tests mock `@/lib/wallet`'s `useWallet` directly instead of standing up a
 * real Freighter-backed provider, matching the rest of this suite.
 */
export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        {ui}
      </ThemeProvider>
    </QueryClientProvider>
  )
}

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

process.env.NEXT_PUBLIC_BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000'
process.env.NEXT_PUBLIC_IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/'

// `globals: false` in vitest.config.mts means RTL's own auto-cleanup (which
// relies on detecting a global `afterEach`) never registers, so a page
// rendered in one test stays in the DOM for the next `it()` in the same
// file. Component tests that query by text/role need this explicit.
afterEach(() => {
  cleanup()
})

// jsdom doesn't implement matchMedia. src/lib/responsive.ts's useScreenSize
// (used by several pages via useIsMobile/useResponsiveCardLayout) calls it
// unconditionally, so any component test that renders one of those pages
// throws without this.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

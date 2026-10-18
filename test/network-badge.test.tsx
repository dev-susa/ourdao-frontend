// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import { NetworkBadge } from '@/components/NetworkBadge'

const mockUseWallet = vi.fn()

vi.mock('@/lib/wallet', () => ({
  useWallet: () => mockUseWallet(),
}))

describe('NetworkBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render when wallet is not connected', () => {
    mockUseWallet.mockReturnValue({
      walletNetwork: null,
      isConnected: false,
      appNetwork: 'Testnet',
    })

    // ThemeProvider injects its own <script>, so assert on the badge span
    // rather than on the container being empty.
    const { container } = renderWithProviders(<NetworkBadge />)
    expect(container.querySelector('span')).toBeNull()
  })

  it('does not render when wallet is connected but network is unknown', () => {
    mockUseWallet.mockReturnValue({
      walletNetwork: null,
      isConnected: true,
      appNetwork: 'Testnet',
    })

    const { container } = renderWithProviders(<NetworkBadge />)
    expect(container.querySelector('span')).toBeNull()
  })

  it('renders Mainnet label for PUBLIC network', () => {
    mockUseWallet.mockReturnValue({
      walletNetwork: 'PUBLIC',
      isConnected: true,
      appNetwork: 'Testnet',
    })

    renderWithProviders(<NetworkBadge />)
    expect(screen.getByText('Mainnet')).toBeInTheDocument()
  })

  it('renders Testnet label with visual prominence for TESTNET network', () => {
    mockUseWallet.mockReturnValue({
      walletNetwork: 'TESTNET',
      isConnected: true,
      appNetwork: 'Testnet',
    })

    renderWithProviders(<NetworkBadge />)
    const badge = screen.getByText('Testnet')
    expect(badge).toBeInTheDocument()
    // Testnet has yellow styling for visual distinction
    expect(badge).toHaveClass('bg-yellow-100')
  })

  it('renders Futurenet label with visual prominence for FUTURENET network', () => {
    mockUseWallet.mockReturnValue({
      walletNetwork: 'FUTURENET',
      isConnected: true,
      appNetwork: 'Testnet',
    })

    renderWithProviders(<NetworkBadge />)
    const badge = screen.getByText('Futurenet')
    expect(badge).toBeInTheDocument()
    // Futurenet has purple styling for visual distinction
    expect(badge).toHaveClass('bg-purple-100')
  })

  it('renders unknown network name as-is when not in predefined config', () => {
    mockUseWallet.mockReturnValue({
      walletNetwork: 'Custom Network',
      isConnected: true,
      appNetwork: 'Testnet',
    })

    renderWithProviders(<NetworkBadge />)
    expect(screen.getByText('Custom Network')).toBeInTheDocument()
  })
})

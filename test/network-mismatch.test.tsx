// @vitest-environment jsdom
/**
 * Issue #241 — network-mismatch behaviour is a documented decision with an
 * enforced guard, not an emergent warning.
 *
 * Decision (docs/decisions/ADR-008-network-mismatch.md): mismatch surfaces a
 * banner AND blocks writes. Reads stay available; recovery is automatic via the
 * watcher with no reload.
 *
 * Covers: detect → warn (banner) → block (signXDR + useWriteAction) →
 * recover (switch back clears without reload), plus the unknown-network
 * `passphraseLabel` fallthrough.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Networks } from '@stellar/stellar-sdk'
import {
  WalletProvider,
  useWallet,
  passphraseLabel,
  isNetworkMismatch,
} from '@/lib/wallet'
import { useWriteAction } from '@/hooks/dao/writes'
import * as freighter from '@stellar/freighter-api'

const { mockDaoWriteFn } = vi.hoisted(() => ({ mockDaoWriteFn: vi.fn() }))

const TESTNET_PASSPHRASE = Networks.TESTNET
const PUBLIC_PASSPHRASE = Networks.PUBLIC

type WatchCallback = (params: {
  address: string
  network: string
  networkPassphrase: string
  error?: unknown
}) => void

let watchCallback: WatchCallback | null = null
const mockWatcherStop = vi.fn()

vi.mock('@stellar/freighter-api', () => ({
  isAllowed: vi.fn(),
  requestAccess: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
  signMessage: vi.fn(),
  isConnected: vi.fn().mockResolvedValue({ isConnected: true, version: '2.5.0' }),
  WatchWalletChanges: vi.fn().mockImplementation(function () {
    return {
      watch: vi.fn((cb: WatchCallback) => {
        watchCallback = cb
        return {}
      }),
      stop: mockWatcherStop,
    }
  }),
}))

vi.mock('@/lib/stellar', () => ({
  NETWORK_PASSPHRASE: Networks.TESTNET,
  getTransactionUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  getContractUrl: (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`,
  getAddressUrl: (addr: string) => `https://stellar.expert/explorer/testnet/account/${addr}`,
}))

vi.mock('@/lib/dao-client', () => ({
  daoWrite: (...args: unknown[]) => {
    mockDaoWriteFn(...args)
    return { registerMember: vi.fn() }
  },
  InvokeError: class InvokeError extends Error {
    retryable = true
  },
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'toast-id'),
    dismiss: vi.fn(),
  },
}))

function Harness({ onRender }: { onRender: (w: ReturnType<typeof useWallet>) => void }) {
  const wallet = useWallet()
  onRender(wallet)
  return null
}

function renderMismatchProvider(onRender: (w: ReturnType<typeof useWallet>) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <WalletProvider>
        <Harness onRender={onRender} />
      </WalletProvider>
    </QueryClientProvider>
  )
}

describe('issue #241 — passphraseLabel and isNetworkMismatch', () => {
  it('labels the three known networks', () => {
    expect(passphraseLabel(Networks.PUBLIC)).toBe('Mainnet')
    expect(passphraseLabel(Networks.TESTNET)).toBe('Testnet')
    expect(passphraseLabel(Networks.FUTURENET)).toBe('Futurenet')
  })

  it('falls through to the raw passphrase for unknown networks', () => {
    expect(passphraseLabel('Custom Network ; 2026')).toBe('Custom Network ; 2026')
  })

  it('detects a mismatch only when connected with a known differing passphrase', () => {
    expect(isNetworkMismatch('ACCOUNT_A', PUBLIC_PASSPHRASE, TESTNET_PASSPHRASE)).toBe(true)
    expect(isNetworkMismatch('ACCOUNT_A', TESTNET_PASSPHRASE, TESTNET_PASSPHRASE)).toBe(false)
    expect(isNetworkMismatch(null, PUBLIC_PASSPHRASE, TESTNET_PASSPHRASE)).toBe(false)
    expect(isNetworkMismatch('ACCOUNT_A', null, TESTNET_PASSPHRASE)).toBe(false)
  })
})

describe('issue #241 — mismatch banner, guard, and recovery', () => {
  beforeEach(() => {
    watchCallback = null
    mockWatcherStop.mockClear()
    vi.mocked(freighter.WatchWalletChanges).mockClear()
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'ACCOUNT_A' } as never)
    // Wallet starts on Mainnet while the app expects Testnet.
    vi.mocked(freighter.getNetwork).mockResolvedValue({
      network: 'PUBLIC',
      networkPassphrase: PUBLIC_PASSPHRASE,
    } as never)
    vi.mocked(freighter.signTransaction).mockResolvedValue('SIGNED_XDR' as never)
  })

  afterEach(() => vi.clearAllMocks())

  it('shows the banner and blocks signXDR while mismatched', async () => {
    let latest: ReturnType<typeof useWallet> | undefined
    renderMismatchProvider((w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.address).toBe('ACCOUNT_A'))
    // The connect-time getNetwork seeds the mismatch before the watcher fires.
    await waitFor(() => expect(latest?.networkMismatch).toBe(true))

    const banner = await screen.findByTestId('network-mismatch-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner.textContent).toMatch(/transactions are blocked/i)

    await expect(latest!.signXDR('XDR_TX')).rejects.toThrow(/mismatch/i)
    expect(freighter.signTransaction).not.toHaveBeenCalled()
  })

  it('clears the banner without a reload once the wallet switches back', async () => {
    let latest: ReturnType<typeof useWallet> | undefined
    renderMismatchProvider((w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.networkMismatch).toBe(true))
    await screen.findByTestId('network-mismatch-banner')
    expect(freighter.WatchWalletChanges).toHaveBeenCalled()
    expect(watchCallback).not.toBeNull()

    // Switching Freighter back to the configured network clears the state.
    act(() => {
      watchCallback!({
        address: 'ACCOUNT_A',
        network: 'TESTNET',
        networkPassphrase: TESTNET_PASSPHRASE,
      })
    })

    await waitFor(() => expect(latest?.networkMismatch).toBe(false))
    await waitFor(() =>
      expect(screen.queryByTestId('network-mismatch-banner')).not.toBeInTheDocument()
    )
  })

  it('names the raw passphrase when the network is unknown', async () => {
    vi.mocked(freighter.getNetwork).mockResolvedValue({
      network: '',
      networkPassphrase: 'Custom Network ; 2026',
    } as never)

    let latest: ReturnType<typeof useWallet> | undefined
    renderMismatchProvider((w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.networkMismatch).toBe(true))
    const banner = await screen.findByTestId('network-mismatch-banner')
    expect(banner.textContent).toContain('Custom Network ; 2026')
  })

  it('blocks useWriteAction before any signer call while mismatched', async () => {
    mockDaoWriteFn.mockClear()
    function WriteHarness({
      onRender,
    }: {
      onRender: (w: ReturnType<typeof useWriteAction>) => void
    }) {
      const write = useWriteAction()
      onRender(write)
      return null
    }

    let latestWrite: ReturnType<typeof useWriteAction> | undefined
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <WalletProvider>
          <WriteHarness
            onRender={(w) => {
              latestWrite = w
            }}
          />
        </WalletProvider>
      </QueryClientProvider>
    )

    await waitFor(() => expect(latestWrite?.address).toBe('ACCOUNT_A'))
    await waitFor(() => expect(latestWrite?.networkMismatch).toBe(true))

    await expect(
      act(async () => {
        await latestWrite!.run('Testing mismatch guard', () => {
          throw new Error('should not reach daoWrite')
        })
      })
    ).rejects.toThrow(/mismatch/i)
    expect(mockDaoWriteFn).not.toHaveBeenCalled()
  })
})

describe('issue P01-015 — Freighter not installed', () => {
  beforeEach(() => {
    watchCallback = null
    vi.mocked(freighter.isAllowed).mockRejectedValue(new Error('Freighter not installed'))
    vi.mocked(freighter.getAddress).mockRejectedValue(new Error('Freighter not installed'))
    vi.mocked(freighter.getNetwork).mockRejectedValue(new Error('Freighter not installed'))
  })

  afterEach(() => vi.clearAllMocks())

  it('reports freighterNotInstalled and no mismatch when the extension is absent', async () => {
    let latest: ReturnType<typeof useWallet> | undefined
    renderMismatchProvider((w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.isRestoring).toBe(false))
    expect(latest?.address).toBeNull()
    expect(latest?.networkMismatch).toBe(false)
    expect(latest?.freighterNotInstalled).toBe(true)
    expect(screen.queryByTestId('network-mismatch-banner')).not.toBeInTheDocument()
  })

  it('shows the app network label even without a wallet', async () => {
    let latest: ReturnType<typeof useWallet> | undefined
    renderMismatchProvider((w) => {
      latest = w
    })

    await waitFor(() => expect(latest?.isRestoring).toBe(false))
    expect(latest?.appNetwork).toBe('Testnet')
  })
})

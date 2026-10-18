/**
 * Non-Freighter wallets via Stellar Wallets Kit (#344): connect through the
 * picker, sign transactions and messages through the adapter, graceful
 * degradation when a wallet cannot sign messages, session restore, and that
 * Freighter's default path is untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as freighter from '@stellar/freighter-api'
import { WalletProvider, useWallet } from '@/lib/wallet'
import { MessageSigningUnsupportedError, type WalletAdapter } from '@/lib/wallet-adapter'

const PASSPHRASE = 'Test SDF Network ; September 2015'
const KIT_ADDRESS = 'GKITKITKITKITKITKITKITKITKITKITKITKITKITKITKITKITKITKIT'
const FREIGHTER_ADDRESS = 'GFREIGHTERFREIGHTERFREIGHTERFREIGHTERFREIGHTERFREIGHT'

vi.mock('@stellar/freighter-api', () => ({
  isAllowed: vi.fn(),
  requestAccess: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
  signMessage: vi.fn(),
  isConnected: vi.fn(),
  WatchWalletChanges: vi.fn().mockImplementation(function () {
    return { watch: vi.fn(), stop: vi.fn() }
  }),
}))

vi.mock('@/lib/stellar', () => ({ NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015' }))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

type Wallet = ReturnType<typeof useWallet>

function fakeKit(overrides: Partial<WalletAdapter> = {}): WalletAdapter {
  return {
    connect: vi.fn().mockResolvedValue(KIT_ADDRESS),
    getAddress: vi.fn().mockResolvedValue(null),
    signTransaction: vi.fn().mockResolvedValue('KIT_SIGNED'),
    signMessage: vi.fn().mockResolvedValue('KIT_SIG'),
    getNetwork: vi.fn().mockResolvedValue({ network: 'TESTNET', networkPassphrase: PASSPHRASE }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function mount(kitAdapter: WalletAdapter) {
  const ref: { current: Wallet | null } = { current: null }
  function Probe() {
    ref.current = useWallet()
    return null
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <WalletProvider kitAdapter={kitAdapter}>
        <Probe />
      </WalletProvider>
    </QueryClientProvider>
  )
  return ref
}

const w = (ref: { current: Wallet | null }) => ref.current as Wallet

beforeEach(() => {
  window.localStorage.clear()
  vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: false } as never)
  vi.mocked(freighter.getAddress).mockResolvedValue({ address: FREIGHTER_ADDRESS } as never)
  vi.mocked(freighter.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: PASSPHRASE } as never)
  vi.mocked(freighter.isConnected).mockResolvedValue({ isConnected: true, version: '2.5.0' } as never)
  vi.mocked(freighter.requestAccess).mockResolvedValue({ address: FREIGHTER_ADDRESS } as never)
  vi.mocked(freighter.signTransaction).mockResolvedValue({ signedTxXdr: 'FREIGHTER_SIGNED' } as never)
})

afterEach(() => vi.clearAllMocks())

describe('connectWithKit', () => {
  it('connects through the kit and signs transactions with it, not Freighter', async () => {
    const kit = fakeKit()
    const ref = mount(kit)
    await waitFor(() => expect(w(ref).isRestoring).toBe(false))

    await act(() => w(ref).connectWithKit())
    expect(w(ref).address).toBe(KIT_ADDRESS)
    expect(w(ref).isConnected).toBe(true)

    await expect(w(ref).signXDR('XDR')).resolves.toBe('KIT_SIGNED')
    expect(kit.signTransaction).toHaveBeenCalledWith('XDR', KIT_ADDRESS)
    expect(freighter.signTransaction).not.toHaveBeenCalled()
  })

  it('does not start Freighter\'s change watcher for a kit wallet', async () => {
    const ref = mount(fakeKit())
    await waitFor(() => expect(w(ref).isRestoring).toBe(false))
    await act(() => w(ref).connectWithKit())
    expect(freighter.WatchWalletChanges).not.toHaveBeenCalled()
  })

  it('signs messages through the kit', async () => {
    const kit = fakeKit()
    const ref = mount(kit)
    await waitFor(() => expect(w(ref).isRestoring).toBe(false))
    await act(() => w(ref).connectWithKit())
    await expect(w(ref).signMessage('hello')).resolves.toBe('KIT_SIG')
    expect(kit.signMessage).toHaveBeenCalledWith('hello', KIT_ADDRESS)
    expect(freighter.signMessage).not.toHaveBeenCalled()
  })

  it('rejects signMessage for a wallet without message signing so backend auth can degrade', async () => {
    const kit = fakeKit({ signMessage: vi.fn().mockRejectedValue(new MessageSigningUnsupportedError()) })
    const ref = mount(kit)
    await waitFor(() => expect(w(ref).isRestoring).toBe(false))
    await act(() => w(ref).connectWithKit())
    await expect(w(ref).signMessage('hello')).rejects.toBeInstanceOf(MessageSigningUnsupportedError)
  })

  it('blocks signing and flags a mismatch when the kit wallet is on another network', async () => {
    const kit = fakeKit({
      getNetwork: vi.fn().mockResolvedValue({ network: 'PUBLIC', networkPassphrase: 'Public Global Stellar Network ; September 2015' }),
    })
    const ref = mount(kit)
    await waitFor(() => expect(w(ref).isRestoring).toBe(false))
    await act(() => w(ref).connectWithKit())
    expect(w(ref).networkMismatch).toBe(true)
    await expect(w(ref).signXDR('XDR')).rejects.toThrow(/network mismatch/i)
    expect(kit.signTransaction).not.toHaveBeenCalled()
  })

  it('stays connected without a network when the wallet cannot report one', async () => {
    const kit = fakeKit({ getNetwork: vi.fn().mockRejectedValue(new Error('unsupported')) })
    const ref = mount(kit)
    await waitFor(() => expect(w(ref).isRestoring).toBe(false))
    await act(() => w(ref).connectWithKit())
    expect(w(ref).isConnected).toBe(true)
    expect(w(ref).networkMismatch).toBe(false)
  })

  it('stays disconnected and stops connecting when the user dismisses the picker', async () => {
    const kit = fakeKit({ connect: vi.fn().mockRejectedValue(new Error('closed')) })
    const ref = mount(kit)
    await waitFor(() => expect(w(ref).isRestoring).toBe(false))
    await act(() => w(ref).connectWithKit())
    expect(w(ref).isConnected).toBe(false)
    expect(w(ref).connecting).toBe(false)
  })

  it('disconnect clears the kit session and tells the kit', async () => {
    const kit = fakeKit()
    const ref = mount(kit)
    await waitFor(() => expect(w(ref).isRestoring).toBe(false))
    await act(() => w(ref).connectWithKit())
    expect(window.localStorage.getItem('ourdao:wallet-session')).toBe('kit')

    act(() => w(ref).disconnect())
    expect(w(ref).isConnected).toBe(false)
    expect(kit.disconnect).toHaveBeenCalled()
    expect(window.localStorage.getItem('ourdao:wallet-session')).toBeNull()
  })
})

describe('session restore', () => {
  it('restores a kit session on reload without asking Freighter', async () => {
    window.localStorage.setItem('ourdao:wallet-session', 'kit')
    const kit = fakeKit({ getAddress: vi.fn().mockResolvedValue(KIT_ADDRESS) })
    const ref = mount(kit)
    await waitFor(() => expect(w(ref).address).toBe(KIT_ADDRESS))
    expect(w(ref).isRestoring).toBe(false)
    expect(freighter.isAllowed).not.toHaveBeenCalled()
    await expect(w(ref).signXDR('XDR')).resolves.toBe('KIT_SIGNED')
  })

  it('falls back to Freighter when the remembered kit session is gone', async () => {
    window.localStorage.setItem('ourdao:wallet-session', 'kit')
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    const ref = mount(fakeKit({ getAddress: vi.fn().mockResolvedValue(null) }))
    await waitFor(() => expect(w(ref).address).toBe(FREIGHTER_ADDRESS))
    expect(window.localStorage.getItem('ourdao:wallet-session')).toBeNull()
  })

  it('leaves the kit unused when there is no remembered kit session', async () => {
    const kit = fakeKit()
    const ref = mount(kit)
    await waitFor(() => expect(w(ref).isRestoring).toBe(false))
    expect(kit.getAddress).not.toHaveBeenCalled()
  })
})

describe('Freighter default path', () => {
  it('connect() still uses Freighter and signs with it', async () => {
    const kit = fakeKit()
    const ref = mount(kit)
    await waitFor(() => expect(w(ref).isRestoring).toBe(false))
    await act(() => w(ref).connect())
    expect(w(ref).address).toBe(FREIGHTER_ADDRESS)
    await expect(w(ref).signXDR('XDR')).resolves.toBe('FREIGHTER_SIGNED')
    expect(kit.connect).not.toHaveBeenCalled()
    expect(kit.signTransaction).not.toHaveBeenCalled()
  })
})

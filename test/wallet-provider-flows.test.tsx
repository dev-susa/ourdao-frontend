// @vitest-environment jsdom
/**
 * WalletProvider connection and signing flows (#329): session restore,
 * connect failure, every Freighter response shape, signing rejection,
 * network-mismatch guard, disconnect, and signMessage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as freighter from '@stellar/freighter-api'
import toast from 'react-hot-toast'
import { WalletProvider, passphraseLabel, readAddress, readSigned, useOptionalWallet, useWallet } from '@/lib/wallet'

const PASSPHRASE = 'Test SDF Network ; September 2015'
const ADDRESS = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW'

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

vi.mock('@/lib/stellar', () => ({
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}))

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

type Wallet = ReturnType<typeof useWallet>

function mount() {
  const ref: { current: Wallet | null } = { current: null }
  function Probe() {
    ref.current = useWallet()
    return null
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <WalletProvider>
        <Probe />
      </WalletProvider>
    </QueryClientProvider>
  )
  return { ref, client, ...view }
}

const wallet = (ref: { current: Wallet | null }) => ref.current as Wallet

beforeEach(() => {
  vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: false } as never)
  vi.mocked(freighter.getAddress).mockResolvedValue({ address: ADDRESS } as never)
  vi.mocked(freighter.getNetwork).mockResolvedValue({ network: 'TESTNET', networkPassphrase: PASSPHRASE } as never)
  vi.mocked(freighter.isConnected).mockResolvedValue({ isConnected: true, version: '2.5.0' } as never)
})

afterEach(() => vi.clearAllMocks())

describe('response shape normalisers', () => {
  it('readAddress: unknown shapes yield an empty address', () => {
    expect(readAddress(null)).toMatchObject({ address: '', branch: 'unknown' })
    expect(readAddress({})).toMatchObject({ address: '', branch: 'unknown' })
  })

  it('readSigned: unknown shapes yield an empty signature', () => {
    expect(readSigned(undefined)).toMatchObject({ signedTxXdr: '', branch: 'unknown' })
  })

  it('readSigned: an error field wins over any payload', () => {
    expect(readSigned({ signedTxXdr: 'X', error: 'denied' })).toMatchObject({
      signedTxXdr: 'X',
      error: 'denied',
      branch: 'object_error',
    })
  })

  it('passphraseLabel names known networks and echoes unknown ones', () => {
    expect(passphraseLabel(PASSPHRASE)).toBe('Testnet')
    expect(passphraseLabel('Public Global Stellar Network ; September 2015')).toBe('Mainnet')
    expect(passphraseLabel('Test SDF Future Network ; October 2022')).toBe('Futurenet')
    expect(passphraseLabel('custom net')).toBe('custom net')
  })
})

describe('session restore', () => {
  it('restores an allowed session and seeds the wallet network', async () => {
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    const { ref } = mount()
    expect(wallet(ref).isRestoring).toBe(true)

    await waitFor(() => expect(wallet(ref).isRestoring).toBe(false))
    expect(wallet(ref).address).toBe(ADDRESS)
    expect(wallet(ref).isConnected).toBe(true)
    expect(wallet(ref).walletNetwork).toBe('TESTNET')
    expect(wallet(ref).networkMismatch).toBe(false)
  })

  it('accepts a bare boolean from isAllowed (older Freighter)', async () => {
    vi.mocked(freighter.isAllowed).mockResolvedValue(true as never)
    vi.mocked(freighter.getAddress).mockResolvedValue(ADDRESS as never)
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).address).toBe(ADDRESS))
  })

  it('stays disconnected and flags a missing extension when access is not granted', async () => {
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).isRestoring).toBe(false))
    expect(wallet(ref).address).toBeNull()
    expect(wallet(ref).freighterNotInstalled).toBe(true)
  })

  it('treats a throwing Freighter as not installed', async () => {
    vi.mocked(freighter.isAllowed).mockRejectedValue(new Error('no extension'))
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).isRestoring).toBe(false))
    expect(wallet(ref).isConnected).toBe(false)
    expect(wallet(ref).freighterNotInstalled).toBe(true)
  })

  it('ignores a network read that reports an error', async () => {
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    vi.mocked(freighter.getNetwork).mockResolvedValue({ error: 'x' } as never)
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).address).toBe(ADDRESS))
    expect(wallet(ref).walletNetwork).toBeNull()
  })

  it('does not set state after unmount', async () => {
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    const { unmount } = mount()
    unmount()
    await act(async () => {})
    expect(freighter.getNetwork).not.toHaveBeenCalled()
  })
})

describe('connect()', () => {
  it('connects with an object response and records the version', async () => {
    vi.mocked(freighter.requestAccess).mockResolvedValue({ address: ADDRESS } as never)
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).isRestoring).toBe(false))

    await act(async () => wallet(ref).connect())

    expect(wallet(ref).address).toBe(ADDRESS)
    expect(wallet(ref).connecting).toBe(false)
    expect(wallet(ref).freighterVersion).toBe('2.5.0')
    expect(wallet(ref).isVersionSupported).toBe(true)
  })

  it('connects with a bare-string response', async () => {
    vi.mocked(freighter.requestAccess).mockResolvedValue(ADDRESS as never)
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).isRestoring).toBe(false))
    await act(async () => wallet(ref).connect())
    expect(wallet(ref).address).toBe(ADDRESS)
  })

  it('flags an unsupported Freighter version', async () => {
    vi.mocked(freighter.isConnected).mockResolvedValue({ isConnected: true, version: '1.0.0' } as never)
    vi.mocked(freighter.requestAccess).mockResolvedValue({ address: ADDRESS } as never)
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).isRestoring).toBe(false))
    await act(async () => wallet(ref).connect())
    expect(wallet(ref).isVersionSupported).toBe(false)
  })

  it('prefers window.freighter.getFreighterVersion when present', async () => {
    const win = window as unknown as { freighter?: { getFreighterVersion: () => Promise<string> } }
    win.freighter = { getFreighterVersion: async () => '3.1.0' }
    vi.mocked(freighter.requestAccess).mockResolvedValue({ address: ADDRESS } as never)
    try {
      const { ref } = mount()
      await waitFor(() => expect(wallet(ref).isRestoring).toBe(false))
      await act(async () => wallet(ref).connect())
      expect(wallet(ref).freighterVersion).toBe('3.1.0')
      expect(freighter.isConnected).not.toHaveBeenCalled()
    } finally {
      delete win.freighter
    }
  })

  it.each([
    ['an error field', { address: '', error: 'User declined' }],
    ['an empty address', { address: '' }],
  ])('toasts and stays disconnected on %s', async (_label, response) => {
    vi.mocked(freighter.requestAccess).mockResolvedValue(response as never)
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).isRestoring).toBe(false))

    await act(async () => wallet(ref).connect())

    expect(wallet(ref).address).toBeNull()
    expect(wallet(ref).connecting).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Could not connect to Freighter')
  })

  it('toasts when requestAccess throws (extension missing)', async () => {
    vi.mocked(freighter.requestAccess).mockRejectedValue(new Error('boom'))
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).isRestoring).toBe(false))
    await act(async () => wallet(ref).connect())
    expect(wallet(ref).isConnected).toBe(false)
    expect(toast.error).toHaveBeenCalled()
  })

  it('still connects when the follow-up network read throws', async () => {
    vi.mocked(freighter.requestAccess).mockResolvedValue({ address: ADDRESS } as never)
    vi.mocked(freighter.getNetwork).mockRejectedValue(new Error('net'))
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).isRestoring).toBe(false))
    await act(async () => wallet(ref).connect())
    expect(wallet(ref).address).toBe(ADDRESS)
  })
})

describe('disconnect()', () => {
  it('forgets the address and wallet network', async () => {
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    const { ref } = mount()
    await waitFor(() => expect(wallet(ref).isConnected).toBe(true))

    act(() => wallet(ref).disconnect())

    expect(wallet(ref).address).toBeNull()
    expect(wallet(ref).walletNetwork).toBeNull()
    expect(wallet(ref).isConnected).toBe(false)
  })
})

describe('signXDR()', () => {
  async function connected() {
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    const m = mount()
    await waitFor(() => expect(wallet(m.ref).isConnected).toBe(true))
    return m
  }

  it.each([
    ['an object', { signedTxXdr: 'SIGNED' }],
    ['a bare string', 'SIGNED'],
  ])('returns the signed XDR from %s response', async (_label, response) => {
    vi.mocked(freighter.signTransaction).mockResolvedValue(response as never)
    const { ref } = await connected()
    await expect(wallet(ref).signXDR('XDR')).resolves.toBe('SIGNED')
    expect(freighter.signTransaction).toHaveBeenCalledWith('XDR', {
      networkPassphrase: PASSPHRASE,
      address: ADDRESS,
    })
  })

  it('throws Freighter\'s error when the member rejects the prompt', async () => {
    vi.mocked(freighter.signTransaction).mockResolvedValue({ signedTxXdr: '', error: 'User declined' } as never)
    const { ref } = await connected()
    await expect(wallet(ref).signXDR('XDR')).rejects.toThrow('User declined')
  })

  it('throws when Freighter returns no signature at all', async () => {
    vi.mocked(freighter.signTransaction).mockResolvedValue({} as never)
    const { ref } = await connected()
    await expect(wallet(ref).signXDR('XDR')).rejects.toThrow('Freighter returned no signed transaction')
  })

  it('propagates a rejected signTransaction call', async () => {
    vi.mocked(freighter.signTransaction).mockRejectedValue(new Error('extension crashed'))
    const { ref } = await connected()
    await expect(wallet(ref).signXDR('XDR')).rejects.toThrow('extension crashed')
  })

  it('blocks signing, without calling Freighter, when the wallet is on another network', async () => {
    vi.mocked(freighter.getNetwork).mockResolvedValue({
      network: 'PUBLIC',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    } as never)
    const { ref } = await connected()
    await waitFor(() => expect(wallet(ref).networkMismatch).toBe(true))

    await expect(wallet(ref).signXDR('XDR')).rejects.toThrow(/network mismatch/i)
    expect(freighter.signTransaction).not.toHaveBeenCalled()
  })

  it('rejects when signing is aborted by the caller', async () => {
    vi.mocked(freighter.signTransaction).mockReturnValue(new Promise(() => {}) as never)
    const { ref } = await connected()
    const controller = new AbortController()
    const pending = wallet(ref).signXDR('XDR', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow('Signing cancelled')
  })
})

describe('signMessage()', () => {
  async function connected() {
    vi.mocked(freighter.isAllowed).mockResolvedValue({ isAllowed: true } as never)
    const m = mount()
    await waitFor(() => expect(wallet(m.ref).isConnected).toBe(true))
    return m
  }

  it('returns a bare-string signature', async () => {
    vi.mocked(freighter.signMessage).mockResolvedValue('SIG' as never)
    const { ref } = await connected()
    await expect(wallet(ref).signMessage('hi')).resolves.toBe('SIG')
  })

  it('returns the signedMessage of an object response', async () => {
    vi.mocked(freighter.signMessage).mockResolvedValue({ signedMessage: 'SIG2' } as never)
    const { ref } = await connected()
    await expect(wallet(ref).signMessage('hi')).resolves.toBe('SIG2')
  })

  it('returns an empty string when the object has no signature', async () => {
    vi.mocked(freighter.signMessage).mockResolvedValue({} as never)
    const { ref } = await connected()
    await expect(wallet(ref).signMessage('hi')).resolves.toBe('')
  })

  it('throws Freighter\'s error field', async () => {
    vi.mocked(freighter.signMessage).mockResolvedValue({ error: 'declined' } as never)
    const { ref } = await connected()
    await expect(wallet(ref).signMessage('hi')).rejects.toThrow('declined')
  })

  it('is blocked on a network mismatch', async () => {
    vi.mocked(freighter.getNetwork).mockResolvedValue({
      network: 'PUBLIC',
      networkPassphrase: 'Public Global Stellar Network ; September 2015',
    } as never)
    const { ref } = await connected()
    await waitFor(() => expect(wallet(ref).networkMismatch).toBe(true))
    await expect(wallet(ref).signMessage('hi')).rejects.toThrow(/network mismatch/i)
    expect(freighter.signMessage).not.toHaveBeenCalled()
  })
})

describe('hooks outside a provider', () => {
  it('useWallet throws a clear error', () => {
    function Bare() {
      useWallet()
      return null
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Bare />)).toThrow('useWallet must be used within a WalletProvider')
    spy.mockRestore()
  })

  it('useOptionalWallet returns an empty object', () => {
    let value: unknown
    function Bare() {
      value = useOptionalWallet()
      return null
    }
    render(<Bare />)
    expect(value).toEqual({})
  })
})

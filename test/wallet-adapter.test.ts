import { describe, expect, it, vi } from 'vitest'
import {
  createKitAdapter,
  MessageSigningUnsupportedError,
  toError,
  type WalletKit,
} from '@/lib/wallet-adapter'

const PASSPHRASE = 'Test SDF Network ; September 2015'

function fakeKit(overrides: Partial<WalletKit> = {}): WalletKit {
  return {
    authModal: vi.fn().mockResolvedValue({ address: 'GADDR' }),
    getAddress: vi.fn().mockResolvedValue({ address: 'GADDR' }),
    signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: 'SIGNED' }),
    signMessage: vi.fn().mockResolvedValue({ signedMessage: 'SIG' }),
    getNetwork: vi.fn().mockResolvedValue({ network: 'TESTNET', networkPassphrase: PASSPHRASE }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

const adapterFor = (kit: WalletKit) => createKitAdapter(async () => kit, PASSPHRASE)

describe('toError', () => {
  it('passes Errors through and wraps strings and { message } objects', () => {
    const e = new Error('x')
    expect(toError(e)).toBe(e)
    expect(toError('boom').message).toBe('boom')
    expect(toError({ code: -4, message: 'User declined' }).message).toBe('User declined')
    expect(toError(null).message).toBe('Wallet request failed')
  })
})

describe('createKitAdapter', () => {
  it('connects through the wallet picker and returns the address', async () => {
    const kit = fakeKit()
    expect(await adapterFor(kit).connect()).toBe('GADDR')
    expect(kit.authModal).toHaveBeenCalled()
  })

  it('rejects connect with a real Error when the user dismisses the picker', async () => {
    const kit = fakeKit({ authModal: vi.fn().mockRejectedValue({ code: -1, message: 'closed' }) })
    await expect(adapterFor(kit).connect()).rejects.toThrow('closed')
  })

  it('rejects connect when no address comes back', async () => {
    const kit = fakeKit({ authModal: vi.fn().mockResolvedValue({ address: '' }) })
    await expect(adapterFor(kit).connect()).rejects.toThrow('No address')
  })

  it('restores the session address, or null when the kit has none', async () => {
    expect(await adapterFor(fakeKit()).getAddress()).toBe('GADDR')
    const none = fakeKit({ getAddress: vi.fn().mockRejectedValue(new Error('no wallet')) })
    expect(await adapterFor(none).getAddress()).toBeNull()
    const empty = fakeKit({ getAddress: vi.fn().mockResolvedValue({ address: '' }) })
    expect(await adapterFor(empty).getAddress()).toBeNull()
  })

  it('returns null from getAddress even if the kit fails to load', async () => {
    const adapter = createKitAdapter(() => Promise.reject(new Error('no window')), PASSPHRASE)
    expect(await adapter.getAddress()).toBeNull()
  })

  it('signs transactions on the configured network for the given address', async () => {
    const kit = fakeKit()
    expect(await adapterFor(kit).signTransaction('XDR', 'GADDR')).toBe('SIGNED')
    expect(kit.signTransaction).toHaveBeenCalledWith('XDR', {
      networkPassphrase: PASSPHRASE,
      address: 'GADDR',
    })
  })

  it('rejects an empty signed transaction and surfaces wallet rejections', async () => {
    const empty = fakeKit({ signTransaction: vi.fn().mockResolvedValue({ signedTxXdr: '' }) })
    await expect(adapterFor(empty).signTransaction('X', 'G')).rejects.toThrow('rejected')
    const denied = fakeKit({
      signTransaction: vi.fn().mockRejectedValue({ code: -4, message: 'User declined' }),
    })
    await expect(adapterFor(denied).signTransaction('X', 'G')).rejects.toThrow('User declined')
  })

  it('signs messages', async () => {
    const kit = fakeKit()
    expect(await adapterFor(kit).signMessage('hello', 'GADDR')).toBe('SIG')
    expect(kit.signMessage).toHaveBeenCalledWith('hello', {
      networkPassphrase: PASSPHRASE,
      address: 'GADDR',
    })
  })

  it('degrades to MessageSigningUnsupportedError for wallets without signMessage', async () => {
    const kit = fakeKit({
      signMessage: vi.fn().mockRejectedValue({ code: -1, message: 'signMessage is not supported' }),
    })
    await expect(adapterFor(kit).signMessage('m', 'G')).rejects.toBeInstanceOf(
      MessageSigningUnsupportedError
    )
  })

  it('rethrows other message-signing failures and empty signatures', async () => {
    const declined = fakeKit({
      signMessage: vi.fn().mockRejectedValue({ code: -4, message: 'User declined' }),
    })
    await expect(adapterFor(declined).signMessage('m', 'G')).rejects.toThrow('User declined')
    const empty = fakeKit({ signMessage: vi.fn().mockResolvedValue({ signedMessage: '' }) })
    await expect(adapterFor(empty).signMessage('m', 'G')).rejects.toThrow('rejected')
  })

  it('delegates getNetwork and disconnect', async () => {
    const kit = fakeKit()
    const adapter = adapterFor(kit)
    expect((await adapter.getNetwork()).networkPassphrase).toBe(PASSPHRASE)
    await adapter.disconnect()
    expect(kit.disconnect).toHaveBeenCalled()
  })
})

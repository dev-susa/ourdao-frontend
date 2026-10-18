import type { Networks } from '@creit.tech/stellar-wallets-kit/types'

/**
 * Wallet access behind a small interface so the app is not tied to one wallet
 * SDK. The default implementation is backed by Stellar Wallets Kit (Freighter,
 * xBull, Albedo, LOBSTR, hardware wallets, ...), with Freighter preselected.
 */

export interface WalletAdapter {
  /** Opens the wallet picker and resolves to the connected address. */
  connect(): Promise<string>
  /** Restores a previously authorised session without a popup, or null. */
  getAddress(): Promise<string | null>
  /** Signs a base64 transaction XDR and returns the signed XDR. */
  signTransaction(xdr: string, address: string): Promise<string>
  /** Signs an arbitrary message (backend auth). Throws if the wallet cannot. */
  signMessage(message: string, address: string): Promise<string>
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>
  disconnect(): Promise<void>
}

/** Thrown by `signMessage` when the selected wallet has no message signing. */
export class MessageSigningUnsupportedError extends Error {
  constructor() {
    super('The connected wallet does not support message signing')
    this.name = 'MessageSigningUnsupportedError'
  }
}

/** The subset of Stellar Wallets Kit's static API the adapter relies on. */
export interface WalletKit {
  authModal(): Promise<{ address: string }>
  getAddress(): Promise<{ address: string }>
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string }
  ): Promise<{ signedTxXdr: string }>
  signMessage(
    message: string,
    opts?: { networkPassphrase?: string; address?: string }
  ): Promise<{ signedMessage: string }>
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>
  disconnect(): Promise<void>
}

/** Wallet SDKs reject with plain `{ code, message }` objects, not Errors. */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err
  if (typeof err === 'string') return new Error(err)
  const message = (err as { message?: unknown } | null)?.message
  return new Error(typeof message === 'string' && message ? message : 'Wallet request failed')
}

// Kit/wallet error text for a module that has no signMessage implementation.
const UNSUPPORTED = /not (yet )?(supported|implemented)|unsupported/i

export function createKitAdapter(
  loadKit: () => Promise<WalletKit>,
  networkPassphrase: string
): WalletAdapter {
  const call = async <T>(fn: (kit: WalletKit) => Promise<T>): Promise<T> => {
    try {
      return await fn(await loadKit())
    } catch (err) {
      throw toError(err)
    }
  }

  return {
    async connect() {
      const { address } = await call((k) => k.authModal())
      if (!address) throw new Error('No address returned by the wallet')
      return address
    },
    async getAddress() {
      try {
        const { address } = await (await loadKit()).getAddress()
        return address || null
      } catch {
        return null
      }
    },
    async signTransaction(xdr, address) {
      const { signedTxXdr } = await call((k) =>
        k.signTransaction(xdr, { networkPassphrase, address })
      )
      if (!signedTxXdr) throw new Error('Transaction signing was rejected')
      return signedTxXdr
    },
    async signMessage(message, address) {
      try {
        const { signedMessage } = await call((k) =>
          k.signMessage(message, { networkPassphrase, address })
        )
        if (!signedMessage) throw new Error('Message signing was rejected')
        return signedMessage
      } catch (err) {
        if (err instanceof Error && UNSUPPORTED.test(err.message)) {
          throw new MessageSigningUnsupportedError()
        }
        throw err
      }
    },
    getNetwork: () => call((k) => k.getNetwork()),
    disconnect: () => call((k) => k.disconnect()),
  }
}

let defaultAdapter: WalletAdapter | undefined

/** Lazily builds the Stellar Wallets Kit adapter (browser-only dependencies). */
export function getDefaultWalletAdapter(networkPassphrase: string): WalletAdapter {
  defaultAdapter ??= createKitAdapter(async () => {
    const [{ StellarWalletsKit }, { defaultModules }, { FREIGHTER_ID }] =
      await Promise.all([
        import('@creit.tech/stellar-wallets-kit/sdk'),
        import('@creit.tech/stellar-wallets-kit/modules/utils'),
        import('@creit.tech/stellar-wallets-kit/modules/freighter'),
      ])
    StellarWalletsKit.init({
      modules: defaultModules(),
      selectedWalletId: FREIGHTER_ID,
      network: networkPassphrase as Networks,
    })
    return StellarWalletsKit
  }, networkPassphrase)
  return defaultAdapter
}

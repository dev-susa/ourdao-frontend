'use client'

import { logger } from '@/lib/logger'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  isAllowed,
  requestAccess,
  getAddress,
  getNetwork,
  signTransaction,
  signMessage as freighterSignMessage,
  WatchWalletChanges,
  isConnected as checkFreighterConnected,
} from '@stellar/freighter-api'
import { Networks } from '@stellar/stellar-sdk'
import { useQueryClient } from '@tanstack/react-query'
import { allWalletScopedQueryKeys } from '@/lib/query-keys'
import toast from 'react-hot-toast'
import { NETWORK_PASSPHRASE } from './stellar'
import { getDefaultWalletAdapter, toError, type WalletAdapter } from './wallet-adapter'

// Remembers that the last session used a Stellar Wallets Kit wallet (anything
// other than the default Freighter path) so it can be restored on reload.
const KIT_SESSION_KEY = 'ourdao:wallet-session'

function readKitSession(): boolean {
  try {
    return window.localStorage.getItem(KIT_SESSION_KEY) === 'kit'
  } catch {
    return false
  }
}

function writeKitSession(active: boolean): void {
  try {
    if (active) window.localStorage.setItem(KIT_SESSION_KEY, 'kit')
    else window.localStorage.removeItem(KIT_SESSION_KEY)
  } catch {
    /* storage unavailable — the session just won't be restored */
  }
}

export const MIN_FREIGHTER_VERSION = '2.0.0'

export function isVersionAtLeast(version: string, minVersion: string): boolean {
  const vParts = version.replace(/^v/i, '').split('.').map(Number)
  const minParts = minVersion.replace(/^v/i, '').split('.').map(Number)
  for (let i = 0; i < Math.max(vParts.length, minParts.length); i++) {
    const v = vParts[i] || 0
    const m = minParts[i] || 0
    if (v > m) return true
    if (v < m) return false
  }
  return true
}

interface WalletContextValue {
  address: string | null
  isConnected: boolean
  /**
   * True while the previously-authorized session is still being restored.
   *
   * `isConnected` is false until `isAllowed()` then `getAddress()` resolve, so
   * on a hard refresh it briefly reports "not connected" for a wallet that
   * *is* connected. Route guards must treat this window as "unknown", not
   * "signed out" — otherwise every member gets bounced off a member-only page
   * on every load (#307).
   */
  isRestoring: boolean
  connecting: boolean
  /** Connects with Freighter, the default wallet. */
  connect: () => Promise<void>
  /** Opens the Stellar Wallets Kit picker (xBull, Albedo, LOBSTR, hardware wallets, ...). */
  connectWithKit: () => Promise<void>
  disconnect: () => void
  /** Signs a base64 transaction XDR with the connected wallet and returns the signed XDR. */
  signXDR: (xdr: string, options?: { timeoutMs?: number; signal?: AbortSignal }) => Promise<string>
  /** Signs an arbitrary message and returns the signature. Rejects if the connected wallet cannot sign messages. */
  signMessage: (message: string) => Promise<string>
  /** True when the connected Freighter wallet's active network differs from this app's configured NETWORK_PASSPHRASE. */
  networkMismatch: boolean
  /** Freighter's own network label (e.g. "PUBLIC", "TESTNET"), null until known. */
  walletNetwork: string | null
  /** The app's own configured network label (e.g. "Testnet"), derived from NET_WORK_PASSPHRASE. */
  appNetwork: string
  /** Detected version of the installed Freighter extension, or null if unknown/not installed. */
  freighterVersion: string | null
  /** True if the detected Freighter version meets or exceeds MIN_FREIGHTER_VERSION. */
  isVersionSupported: boolean
  /** True when the Freighter extension is not installed/detected. */
  freighterNotInstalled: boolean
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined)

// Freighter's API has shifted return shapes across versions (bare string vs.
// `{ address }` vs. `{ address, error }`). These normalize both worlds.
export function readAddress(res: unknown): { address: string; error?: string; branch: 'string' | 'object_address' | 'object_error' | 'unknown' } {
  if (typeof res === 'string') {
    logger.info('[Wallet] readAddress branch: string')
    return { address: res, branch: 'string' }
  }
  const r = (res || {}) as { address?: string; error?: unknown }
  if (r.error) {
    logger.warn('[Wallet] readAddress branch: object_error', { error: String(r.error) })
    return { address: r.address || '', error: String(r.error), branch: 'object_error' }
  }
  if (typeof r.address === 'string') {
    logger.info('[Wallet] readAddress branch: object_address')
    return { address: r.address, branch: 'object_address' }
  }
  logger.warn('[Wallet] readAddress branch: unknown response shape', { response: res })
  return { address: '', branch: 'unknown' }
}

export function readSigned(res: unknown): { signedTxXdr: string; error?: string; branch: 'string' | 'object_signed' | 'object_error' | 'unknown' } {
  if (typeof res === 'string') {
    logger.info('[Wallet] readSigned branch: string')
    return { signedTxXdr: res, branch: 'string' }
  }
  const r = (res || {}) as { signedTxXdr?: string; error?: unknown }
  if (r.error) {
    logger.warn('[Wallet] readSigned branch: object_error', { error: String(r.error) })
    return { signedTxXdr: r.signedTxXdr || '', error: String(r.error), branch: 'object_error' }
  }
  if (typeof r.signedTxXdr === 'string') {
    logger.info('[Wallet] readSigned branch: object_signed')
    return { signedTxXdr: r.signedTxXdr, branch: 'object_signed' }
  }
  logger.warn('[Wallet] readSigned branch: unknown response shape')
  return { signedTxXdr: '', branch: 'unknown' }
}

/** Friendly label for a network passphrase, for the mismatch banner. */
export function passphraseLabel(passphrase: string): string {
  switch (passphrase) {
    case Networks.PUBLIC:
      return 'Mainnet'
    case Networks.TESTNET:
      return 'Testnet'
    case Networks.FUTURENET:
      return 'Futurenet'
    default:
      return passphrase
  }
}

/**
 * Pure predicate for the network-mismatch guard (issue #241).
 *
 * Decision (see docs/decisions/ADR-008-network-mismatch.md): a mismatch
 * surfaces a banner AND blocks writes. Reads stay available so members can
 * still inspect state while on the wrong network; `signXDR` and
 * `useWriteAction.run` both reject until the wallet network matches
 * `NETWORK_PASSPHRASE` again. Recovery is automatic via the watcher — no
 * reload required.
 */
export function isNetworkMismatch(
  address: string | null,
  walletNetworkPassphrase: string | null,
  expectedPassphrase: string = NETWORK_PASSPHRASE
): boolean {
  return !!address && !!walletNetworkPassphrase && walletNetworkPassphrase !== expectedPassphrase
}

// Poll interval for Freighter's own watcher (address/network changes aren't
// pushed as DOM events — this is the API's own polling mechanism).
const WALLET_WATCH_INTERVAL_MS = 2000
const DEFAULT_SIGN_TIMEOUT_MS = 60000

export function WalletProvider({
  children,
  kitAdapter,
}: {
  children: React.ReactNode
  /** Overrides the Stellar Wallets Kit adapter (tests). */
  kitAdapter?: WalletAdapter
}) {
  const kit = useMemo(
    () => kitAdapter ?? getDefaultWalletAdapter(NETWORK_PASSPHRASE),
    [kitAdapter]
  )
  // True while the connected wallet is a Kit wallet. Freighter-specific polling
  // and version checks only apply when it is false.
  const [usingKit, setUsingKit] = useState(false)
  const usingKitRef = useRef(false)
  const [address, setAddress] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  // Starts true and flips false as soon as the restore attempt below settles.
  // Freighter's `isAllowed()`/`getAddress()` are async, so for the first
  // render or two `isConnected` is false even for a wallet that is connected —
  // this flag is what tells a route guard to wait rather than redirect (#307).
  const [isRestoring, setIsRestoring] = useState(true)
  const [walletNetworkPassphrase, setWalletNetworkPassphrase] = useState<string | null>(null)
  const [walletNetwork, setWalletNetwork] = useState<string | null>(null)
  const [freighterVersion, setFreighterVersion] = useState<string | null>(null)
  const [isVersionSupported, setIsVersionSupported] = useState<boolean>(true)
  const [freighterNotInstalled, setFreighterNotInstalled] = useState<boolean>(false)

  const queryClient = useQueryClient()

  const addressRef = useRef<string | null>(null)
  const walletNetworkPassphraseRef = useRef<string | null>(null)
  const walletNetworkRef = useRef<string | null>(null)

  useEffect(() => {
    addressRef.current = address
  }, [address])

  useEffect(() => {
    walletNetworkPassphraseRef.current = walletNetworkPassphrase
  }, [walletNetworkPassphrase])

  useEffect(() => {
    walletNetworkRef.current = walletNetwork
  }, [walletNetwork])

  const checkVersion = useCallback(async () => {
    try {
      if (
        typeof window !== 'undefined' &&
        (window as unknown as { freighter?: { getFreighterVersion?: () => Promise<string> } }).freighter?.getFreighterVersion
      ) {
        const ver = await (
          window as unknown as { freighter: { getFreighterVersion: () => Promise<string> } }
        ).freighter.getFreighterVersion()
        if (ver) {
          setFreighterVersion(ver)
          setFreighterNotInstalled(false)
          const supported = isVersionAtLeast(ver, MIN_FREIGHTER_VERSION)
          setIsVersionSupported(supported)
          if (!supported) {
            logger.warn('[Wallet] Freighter version below minimum', { version: ver, minimum: MIN_FREIGHTER_VERSION })
          }
          return ver
        }
      }
      const connInfo = await checkFreighterConnected()
      const ver =
        typeof connInfo === 'object' && connInfo && 'version' in connInfo
          ? String((connInfo as { version?: unknown }).version || '')
          : null
      if (ver) {
        setFreighterVersion(ver)
        setFreighterNotInstalled(false)
        const supported = isVersionAtLeast(ver, MIN_FREIGHTER_VERSION)
        setIsVersionSupported(supported)
        if (!supported) {
          logger.warn('[Wallet] Freighter version below minimum', { version: ver, minimum: MIN_FREIGHTER_VERSION })
        }
        return ver
      }
    } catch {
      /* ignore */
    }
    return null
  }, [])

  const networkMismatch = isNetworkMismatch(address, walletNetworkPassphrase, NETWORK_PASSPHRASE)

  const isConnected = !!address

  // Single WatchWalletChanges watcher that handles both concerns:
  //   1. Network mismatch — update walletNetworkPassphrase/walletNetwork on
  //      poll (only when values change) so the banner reflects the extension's current network.
  //   2. Account switch (issue #59) — when the address changes, update the
  //      in-app address state and invalidate all wallet-scoped React Query
  //      caches so no previous account's data lingers.
  //   3. Tab visibility (issue #218) — pause watcher when tab is hidden, resume on visibility.
  useEffect(() => {
    if (!isConnected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived wallet state on disconnect is a legitimate sync pattern
      setWalletNetworkPassphrase(null)
      setWalletNetwork(null)
      return
    }
    // Freighter's change watcher doesn't apply to other wallets.
    if (usingKit) return

    let watcher: WatchWalletChanges | null = null
    let isPaused = typeof document !== 'undefined' && document.hidden

    const startWatcher = () => {
      if (watcher) return
      watcher = new WatchWalletChanges(WALLET_WATCH_INTERVAL_MS)
      watcher.watch((params) => {
        if (params.error) return

        // --- Issue #218: Only call state setters when values change ---
        const nextPassphrase = params.networkPassphrase || null
        if (nextPassphrase !== walletNetworkPassphraseRef.current) {
          walletNetworkPassphraseRef.current = nextPassphrase
          setWalletNetworkPassphrase(nextPassphrase)
        }

        const nextNetwork = params.network || null
        if (nextNetwork !== walletNetworkRef.current) {
          walletNetworkRef.current = nextNetwork
          setWalletNetwork(nextNetwork)
        }

        // --- account switch tracking ---
        const newAddr = params.address
        if (newAddr && newAddr !== addressRef.current) {
          addressRef.current = newAddr
          setAddress(newAddr)
          for (const queryKey of allWalletScopedQueryKeys()) {
            queryClient.invalidateQueries({ queryKey })
          }
        }
      })
    }

    const stopWatcher = () => {
      if (watcher) {
        watcher.stop()
        watcher = null
      }
    }

    if (!isPaused) {
      startWatcher()
    }

    const handleVisibilityChange = async () => {
      if (typeof document === 'undefined') return
      if (document.hidden) {
        isPaused = true
        stopWatcher()
      } else {
        isPaused = false
        // Resume & immediate check on visibility
        try {
          const { address: currentAddr } = readAddress(await getAddress())
          if (currentAddr && currentAddr !== addressRef.current) {
            addressRef.current = currentAddr
            setAddress(currentAddr)
            for (const queryKey of allWalletScopedQueryKeys()) {
              queryClient.invalidateQueries({ queryKey })
            }
          }
          const net = await getNetwork()
          if (!net.error) {
            const nextPass = net.networkPassphrase || null
            if (nextPass !== walletNetworkPassphraseRef.current) {
              walletNetworkPassphraseRef.current = nextPass
              setWalletNetworkPassphrase(nextPass)
            }
            const nextNet = net.network || null
            if (nextNet !== walletNetworkRef.current) {
              walletNetworkRef.current = nextNet
              setWalletNetwork(nextNet)
            }
          }
        } catch {
          /* ignore */
        }
        startWatcher()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopWatcher()
    }
  }, [isConnected, usingKit, queryClient])

  const seedKitNetwork = useCallback(async () => {
    try {
      const net = await kit.getNetwork()
      walletNetworkPassphraseRef.current = net.networkPassphrase || null
      setWalletNetworkPassphrase(net.networkPassphrase || null)
      walletNetworkRef.current = net.network || null
      setWalletNetwork(net.network || null)
    } catch {
      /* some wallets don't report their network */
    }
  }, [kit])

  // Restore a previously-authorized session on mount and seed the wallet's
  // network from Freighter so the mismatch banner appears before the first
  // watcher poll.
  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      if (readKitSession()) {
        try {
          const addr = await kit.getAddress()
          if (cancelled) return
          if (addr) {
            usingKitRef.current = true
            setUsingKit(true)
            addressRef.current = addr
            setAddress(addr)
            await seedKitNetwork()
            return
          }
          writeKitSession(false)
        } finally {
          if (!cancelled) setIsRestoring(false)
        }
      }
      try {
        const allowed = await isAllowed()
        const isAllowedVal =
          typeof allowed === 'object' && allowed && 'isAllowed' in allowed
            ? Boolean((allowed as { isAllowed?: unknown }).isAllowed)
            : Boolean(allowed)
        if (!isAllowedVal) {
          if (!cancelled) {
            if (!freighterVersion) setFreighterNotInstalled(true)
            setIsRestoring(false)
          }
          return
        }
        const { address: addr } = readAddress(await getAddress())
        if (cancelled) return
        if (addr) {
          addressRef.current = addr
          setAddress(addr)
        }
        const net = await getNetwork()
        if (cancelled) return
        if (!net.error) {
          const nextPass = net.networkPassphrase || null
          walletNetworkPassphraseRef.current = nextPass
          setWalletNetworkPassphrase(nextPass)
          const nextNet = net.network || null
          walletNetworkRef.current = nextNet
          setWalletNetwork(nextNet)
        }
      } catch {
        /* ignore -- not installed or unavailable */
        if (!cancelled) {
          setFreighterNotInstalled(true)
        }
      } finally {
        if (!cancelled) setIsRestoring(false)
      }
    }
    restore()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [])

  const connect = useCallback(async () => {
    setConnecting(true)
    try {
      await checkVersion()
      const access = await requestAccess()
      const { address: addr, error } = readAddress(access)
      if (error || !addr) {
        throw new Error(error || 'Freighter returned no address')
      }
      addressRef.current = addr
      setAddress(addr)
      // Read the wallet's network at connect time so a mismatch is visible
      // immediately, before the watcher's first poll.
      try {
        const net = await getNetwork()
        if (!net.error) {
          const nextPass = net.networkPassphrase || null
          walletNetworkPassphraseRef.current = nextPass
          setWalletNetworkPassphrase(nextPass)
          const nextNet = net.network || null
          walletNetworkRef.current = nextNet
          setWalletNetwork(nextNet)
        }
      } catch {
        /* ignore */
      }
    } catch (e) {
      logger.error('[Wallet] connect failed', { error: String(e) })
      toast.error('Could not connect to Freighter')
    } finally {
      setConnecting(false)
    }
  }, [checkVersion])

  const connectWithKit = useCallback(async () => {
    setConnecting(true)
    try {
      const addr = await kit.connect()
      usingKitRef.current = true
      setUsingKit(true)
      writeKitSession(true)
      addressRef.current = addr
      setAddress(addr)
      await seedKitNetwork()
    } catch (e) {
      logger.error('[Wallet] kit connect failed', { error: String(e) })
      toast.error(`Could not connect wallet: ${toError(e).message}`)
    } finally {
      setConnecting(false)
    }
  }, [kit, seedKitNetwork])

  const disconnect = useCallback(() => {
    if (usingKitRef.current) {
      usingKitRef.current = false
      setUsingKit(false)
      writeKitSession(false)
      kit.disconnect().catch(() => {})
    }
    addressRef.current = null
    setAddress(null)
    walletNetworkPassphraseRef.current = null
    setWalletNetworkPassphrase(null)
    walletNetworkRef.current = null
    setWalletNetwork(null)
    for (const queryKey of allWalletScopedQueryKeys()) {
      queryClient.invalidateQueries({ queryKey })
    }
  }, [kit, queryClient])

  const signXDR = useCallback(
    async (xdr: string, options?: { timeoutMs?: number; signal?: AbortSignal }) => {
      // Network guard: reject before touching Freighter when the wallet is
      // on a different network than the app built the transaction for.
      if (isNetworkMismatch(addressRef.current, walletNetworkPassphraseRef.current, NETWORK_PASSPHRASE)) {
        const walletLabel = walletNetworkRef.current
          ? passphraseLabel(walletNetworkPassphraseRef.current || '')
          : 'unknown'
        throw new Error(
          `Wallet network mismatch: Freighter is on ${walletLabel}, but this app expects ${passphraseLabel(NETWORK_PASSPHRASE)}. Switch Freighter to ${passphraseLabel(NETWORK_PASSPHRASE)} to continue.`
        )
      }
      const timeoutMs = options?.timeoutMs ?? DEFAULT_SIGN_TIMEOUT_MS
      const signal = options?.signal
      const result = await Promise.race([
        usingKitRef.current
          ? kit.signTransaction(xdr, addressRef.current || '')
          : signTransaction(xdr, {
              networkPassphrase: NETWORK_PASSPHRASE,
              address: addressRef.current || undefined,
            }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Signing timed out')), timeoutMs)
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timer)
              reject(new Error('Signing cancelled'))
            })
          }
        }),
      ])
      const { signedTxXdr, error } = readSigned(result)
      if (error || !signedTxXdr) {
        throw new Error(error || 'Freighter returned no signed transaction')
      }
      return signedTxXdr
    },
    [kit]
  )

  const signMessage = useCallback(async (message: string) => {
    if (isNetworkMismatch(addressRef.current, walletNetworkPassphraseRef.current, NETWORK_PASSPHRASE)) {
      throw new Error(
        `Wallet network mismatch: switch Freighter to ${passphraseLabel(NETWORK_PASSPHRASE)} to continue.`
      )
    }
    if (usingKitRef.current) {
      return kit.signMessage(message, addressRef.current || '')
    }
    const result = await freighterSignMessage(message)
    if (typeof result === 'string') return result
    const r = result as { signedMessage?: string; error?: unknown }
    if (r.error) throw new Error(String(r.error))
    return r.signedMessage || ''
  }, [kit])

  const value: WalletContextValue = {
    address,
    isConnected,
    isRestoring,
    connecting,
    connect,
    connectWithKit,
    disconnect,
    signXDR,
    signMessage,
    networkMismatch,
    walletNetwork,
    appNetwork: passphraseLabel(NETWORK_PASSPHRASE),
    freighterVersion,
    isVersionSupported,
    freighterNotInstalled,
  }

  return (
    <WalletContext.Provider value={value}>
      {networkMismatch && (
        <div
          data-testid="network-mismatch-banner"
          role="alert"
          className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 sm:px-6"
        >
          <span>
            Wallet network mismatch: Freighter is set to{' '}
            <strong>{walletNetwork || passphraseLabel(walletNetworkPassphrase || '')}</strong>, this app expects{' '}
            <strong>{passphraseLabel(NETWORK_PASSPHRASE)}</strong>. Switch Freighter&apos;s network — transactions are blocked until it matches.
          </span>
        </div>
      )}
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return ctx
}

export function useOptionalWallet(): Partial<WalletContextValue> {
  return useContext(WalletContext) ?? {}
}


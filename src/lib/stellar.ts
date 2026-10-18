'use client'

import { rpc, Networks, StrKey } from '@stellar/stellar-sdk'

/**
 * Stellar / Soroban network configuration.
 *
 * Everything is env-driven with testnet defaults, so the app runs out of the
 * box against public testnet. Point NEXT_PUBLIC_CONTRACT_ID at a deployed
 * OurDAO contract to enable live reads/writes.
 */
export const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || Networks.TESTNET

export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'

/**
 * Human-readable name for the configured network, derived from the passphrase.
 *
 * Used by the header network badge and the wrong-network banner so users can
 * see at a glance which network the app targets.
 */
export const NETWORK_NAME: string =
  NETWORK_PASSPHRASE === Networks.PUBLIC
    ? 'Mainnet'
    : NETWORK_PASSPHRASE === Networks.TESTNET
      ? 'Testnet'
      : NETWORK_PASSPHRASE === Networks.FUTURENET
        ? 'Futurenet'
        : 'Unknown'

/**
 * Compares a wallet-reported network passphrase against the app's configured
 * passphrase.
 *
 * Returns `true` when they match. A missing/empty wallet passphrase is treated
 * as a mismatch so callers can surface an actionable error rather than
 * proceeding to sign against the wrong network.
 */
export const isNetworkPassphraseMatch = (walletPassphrase?: string | null): boolean =>
  !!walletPassphrase && walletPassphrase === NETWORK_PASSPHRASE

/**
 * Actionable message shown when the wallet's active network does not match the
 * app's configured network.
 */
export const getNetworkMismatchMessage = (walletNetwork?: string | null): string => {
  const wallet = walletNetwork && walletNetwork.trim() ? walletNetwork : 'a different network'
  return `Wrong network: switch Freighter to ${NETWORK_NAME} (wallet is on ${wallet})`
}

/** Deployed OurDAO contract id (C...). Empty until a deployment is configured. */
export const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || ''

/**
 * Three-way contract-id status:
 * - `'valid'`        — `CONTRACT_ID` passes `StrKey.isValidContract`; live mode enabled.
 * - `'invalid'`      — `CONTRACT_ID` is non-empty but fails validation (e.g. truncated
 *                      or mistyped); shows a distinct config-error banner so developers
 *                      get a clear error instead of cryptic RPC failures.
 * - `'unconfigured'` — `CONTRACT_ID` is empty; preview / demo mode.
 */
export type ContractIdStatus = 'valid' | 'invalid' | 'unconfigured'

export const contractIdStatus = (): ContractIdStatus => {
  if (!CONTRACT_ID) return 'unconfigured'
  return StrKey.isValidContract(CONTRACT_ID) ? 'valid' : 'invalid'
}

/**
 * Whether a valid contract id is configured.
 *
 * Previously used `startsWith('C')` which accepted truncated or mistyped ids
 * (e.g. `Cabc123`) and caused cryptic RPC failures. Now delegates to
 * `StrKey.isValidContract` for a strict check (#355).
 */
export const isContractConfigured = (): boolean => contractIdStatus() === 'valid'

/**
 * Determines whether a URL points to a local loopback interface.
 */
export function isLoopbackUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr)
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.localhost')
    )
  } catch {
    return false
  }
}

/**
 * Validates that an RPC endpoint is secure or explicitly allowed.
 * Rejects plain HTTP in production builds unless directed to a loopback address
 * or explicitly opted into via NEXT_PUBLIC_ALLOW_INSECURE_RPC=true.
 */
export function validateRpcEndpoint(
  urlStr: string,
  nodeEnv = process.env.NODE_ENV,
  allowInsecure = process.env.NEXT_PUBLIC_ALLOW_INSECURE_RPC === 'true'
): boolean {
  if (urlStr.startsWith('http://')) {
    const isLoopback = isLoopbackUrl(urlStr)
    if (nodeEnv === 'production' && !isLoopback && !allowInsecure) {
      throw new Error(
        `Insecure HTTP RPC endpoint "${urlStr}" is not allowed in production builds. Use HTTPS, connect to localhost, or set NEXT_PUBLIC_ALLOW_INSECURE_RPC=true for trusted private networks.`
      )
    }
    return true
  }
  return false
}

// Validate RPC URL configuration at module initialization
validateRpcEndpoint(SOROBAN_RPC_URL)

/** Shared JSON-RPC client for simulation and submission. */
export const server = new rpc.Server(SOROBAN_RPC_URL, {
  allowHttp: SOROBAN_RPC_URL.startsWith('http://'),
})

// ---------------------------------------------------------------------------
// Explorer URL helpers
// ---------------------------------------------------------------------------

const EXPLORER_BASES: Record<string, string> = {
  [Networks.TESTNET]: 'https://stellar.expert/explorer/testnet',
  [Networks.PUBLIC]: 'https://stellar.expert/explorer/public',
  // Futurenet is intentionally omitted — stellar.expert does not support it
}

/**
 * Returns the explorer base URL for the configured network, or null if the
 * network is unknown or the explorer doesn't support it.
 *
 * stellar.expert does not currently support Futurenet, so we return null for
 * that case rather than pointing at mainnet (a wrong link is worse than none).
 */
function getExplorerBase(): string | null {
  return EXPLORER_BASES[NETWORK_PASSPHRASE] ?? null
}

export const getContractUrl = (contractId: string = CONTRACT_ID): string | null => {
  const base = getExplorerBase()
  return base ? `${base}/contract/${contractId}` : null
}

export const getTransactionUrl = (hash: string): string | null => {
  const base = getExplorerBase()
  return base ? `${base}/tx/${hash}` : null
}

export const getAddressUrl = (address: string): string | null => {
  const base = getExplorerBase()
  return base ? `${base}/account/${address}` : null
}

/** Short display form for a Stellar address or contract id: `GABC…WXYZ`. */
export const formatStellarAddress = (address?: string, chars = 4): string => {
  if (!address) return ''
  if (address.length <= chars * 2 + 1) return address
  return `${address.slice(0, chars)}…${address.slice(-chars)}`
}

/**
 * Address validation result.
 */
export interface AddressValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validates a Stellar address (G...), contract address (C...), or muxed
 * account (M...).
 *
 * Muxed accounts (M…) are supported. The OurDAO contract uses the Soroban
 * `Address` type which accepts muxed accounts, and ourdao-backend's auth
 * path explicitly classifies and resolves them. A muxed strkey is 69
 * characters (M + 68 base32 chars), longer than the 56-character G/C
 * addresses.
 *
 * The base32 alphabet is RFC 4648 `[A-Z2-7]` — 0, 1, 8, 9 are never valid.
 */
export function validateStellarAddress(value: string): AddressValidationResult {
  // Canonical G... (account) and C... (contract) addresses: 56 chars total
  const gcRegex = /^[GC][A-Z2-7]{55}$/
  // Muxed M... addresses: 69 chars total
  const muxedRegex = /^M[A-Z2-7]{68}$/

  if (gcRegex.test(value)) {
    return { valid: true }
  }
  if (muxedRegex.test(value)) {
    return { valid: true }
  }

  // Provide specific error messages for common mistakes
  if (!value) {
    return { valid: false, error: 'Address is required' }
  }
  if (value.length < 56) {
    return { valid: false, error: 'Address is too short' }
  }
  if (value.length > 69) {
    return { valid: false, error: 'Address is too long' }
  }
  if (/^[GC]/.test(value) && value.length !== 56) {
    return { valid: false, error: 'G/C address must be exactly 56 characters' }
  }
  if (value.startsWith('M') && value.length !== 69) {
    return { valid: false, error: 'Muxed address must be exactly 69 characters' }
  }
  if (/[0189]/.test(value)) {
    return { valid: false, error: 'Address contains invalid characters (0, 1, 8, 9 are not valid in base32)' }
  }
  if (value !== value.toUpperCase()) {
    return { valid: false, error: 'Address must be uppercase' }
  }
  if (!/^[GCM]/.test(value)) {
    return { valid: false, error: 'Address must start with G (account), C (contract), or M (muxed)' }
  }

  return { valid: false, error: 'Invalid address format' }
}

/**
 * Returns true when `value` is a well-formed Stellar public key, contract
 * address, or muxed account in canonical (uppercase) form.
 *
 * Supported formats:
 * - G... : Ed25519 public key (56 chars)
 * - C... : Contract address (56 chars)
 * - M... : Muxed account (69 chars)
 *
 * The base32 alphabet is RFC 4648 `[A-Z2-7]` — 0, 1, 8, 9 are never valid.
 *
 * This is the single shared predicate every address-accepting field in the
 * app validates against (governance proposal destinations, admin panel
 * add-admin, notification activity-log address extraction), so the base32
 * character class only has to be correct in one place (#66).
 */
export const isStellarAddress = (value: string): boolean =>
  validateStellarAddress(value).valid
import { describe, expect, it, vi } from 'vitest'
import {
  getContractUrl,
  getTransactionUrl,
  getAddressUrl,
  isStellarAddress,
  validateStellarAddress,
} from '@/lib/stellar'
import { Networks } from '@stellar/stellar-sdk'

// ── Regression #355: contractIdStatus / isContractConfigured validation ─────

describe('contractIdStatus and isContractConfigured (#355)', () => {
  // A canonical Soroban contract address (C + 55 base32 chars)
  const validContractId = 'CA7QYNF7SOWQ3GLR2BGMZEHXR73EWBMGM7OPKJNNOHHEJLBSXMZPQNUD'
  // Non-empty but fails StrKey.isValidContract — the old startsWith('C') bug
  const malformedContractId = 'Cabc123'

  it('returns "valid" and isContractConfigured()=true for a canonical contract id', async () => {
    vi.stubEnv('NEXT_PUBLIC_CONTRACT_ID', validContractId)
    vi.resetModules()
    const { contractIdStatus, isContractConfigured } = await import('@/lib/stellar')
    expect(contractIdStatus()).toBe('valid')
    expect(isContractConfigured()).toBe(true)
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns "invalid" and isContractConfigured()=false for a malformed id that starts with C', async () => {
    vi.stubEnv('NEXT_PUBLIC_CONTRACT_ID', malformedContractId)
    vi.resetModules()
    const { contractIdStatus, isContractConfigured } = await import('@/lib/stellar')
    expect(contractIdStatus()).toBe('invalid')
    expect(isContractConfigured()).toBe(false)
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns "unconfigured" and isContractConfigured()=false when CONTRACT_ID is empty', async () => {
    vi.stubEnv('NEXT_PUBLIC_CONTRACT_ID', '')
    vi.resetModules()
    const { contractIdStatus, isContractConfigured } = await import('@/lib/stellar')
    expect(contractIdStatus()).toBe('unconfigured')
    expect(isContractConfigured()).toBe(false)
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})

describe('stellar explorer URL helpers', () => {
  const testContract = 'CBA2B4 Prostitutas5MFL3GBB3UMY464YPY6YP77M3FJRX'
  const testHash = 'abc123def456'
  const testAddress = 'GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234'

  it('getContractUrl returns a URL containing the contract id on testnet', () => {
    const url = getContractUrl(testContract)
    expect(url).toContain(testContract)
    expect(url).toMatch(/^https:\/\/stellar\.expert\/explorer\/testnet/)
  })

  it('getContractUrl defaults to CONTRACT_ID when no argument', () => {
    const url = getContractUrl()
    expect(url).toMatch(/^https:\/\/stellar\.expert\/explorer\/testnet/)
  })

  it('getTransactionUrl returns a URL containing the hash on testnet', () => {
    const url = getTransactionUrl(testHash)
    expect(url).toContain(testHash)
    expect(url).toContain('/tx/')
    expect(url).toMatch(/^https:\/\/stellar\.expert\/explorer\/testnet/)
  })

  it('getAddressUrl returns a URL containing the address on testnet', () => {
    const url = getAddressUrl(testAddress)
    expect(url).toContain(testAddress)
    expect(url).toContain('/account/')
    expect(url).toMatch(/^https:\/\/stellar\.expert\/explorer\/testnet/)
  })

  it('URLs use testnet by default', () => {
    const contractUrl = getContractUrl(testContract)
    const txUrl = getTransactionUrl(testHash)
    const addrUrl = getAddressUrl(testAddress)

    expect(contractUrl).toContain('/testnet/')
    expect(txUrl).toContain('/testnet/')
    expect(addrUrl).toContain('/testnet/')
  })

  it('returns mainnet URLs when NETWORK_PASSPHRASE is PUBLIC', async () => {
    vi.stubEnv('NEXT_PUBLIC_NETWORK_PASSPHRASE', Networks.PUBLIC)
    vi.resetModules()

    const { getContractUrl: mainnetContractUrl, getTransactionUrl: mainnetTxUrl, getAddressUrl: mainnetAddrUrl } =
      await import('@/lib/stellar')

    expect(mainnetContractUrl(testContract)).toContain('/public/')
    expect(mainnetTxUrl(testHash)).toContain('/public/')
    expect(mainnetAddrUrl(testAddress)).toContain('/public/')

    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns null for Futurenet because stellar.expert does not support it', async () => {
    vi.stubEnv('NEXT_PUBLIC_NETWORK_PASSPHRASE', Networks.FUTURENET)
    vi.resetModules()

    const { getContractUrl: fnContractUrl, getTransactionUrl: fnTxUrl, getAddressUrl: fnAddrUrl } =
      await import('@/lib/stellar')

    expect(fnContractUrl(testContract)).toBeNull()
    expect(fnTxUrl(testHash)).toBeNull()
    expect(fnAddrUrl(testAddress)).toBeNull()

    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('returns null for unknown network passphrase', async () => {
    vi.stubEnv('NEXT_PUBLIC_NETWORK_PASSPHRASE', 'Unknown Network Passphrase')
    vi.resetModules()

    const { getContractUrl: unkContractUrl, getTransactionUrl: unkTxUrl, getAddressUrl: unkAddrUrl } =
      await import('@/lib/stellar')

    expect(unkContractUrl(testContract)).toBeNull()
    expect(unkTxUrl(testHash)).toBeNull()
    expect(unkAddrUrl(testAddress)).toBeNull()

    vi.unstubAllEnvs()
    vi.resetModules()
  })
})

describe('isStellarAddress', () => {
  // Canonical Stellar addresses are uppercase base32: G or C + 55 chars
  // from the RFC 4648 alphabet [A-Z2-7] — 0, 1, 8 and 9 are never valid.
  const validG = 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3MQAXRWUDX'
  const validC = 'CA7QYNF7SOWQ3GLR2BGMZEHXR73EWBMGM7OPKJNNOHHEJLBSXMZPQNUD'
  // Muxed address (M + 68 base32 chars = 69 total)
  const validM = 'MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

  it('returns true for a canonical G-prefixed account address', () => {
    expect(isStellarAddress(validG)).toBe(true)
  })

  it('returns true for a canonical C-prefixed contract address', () => {
    expect(isStellarAddress(validC)).toBe(true)
  })

  it('returns true for a valid M-prefixed muxed address', () => {
    const validM = 'MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    expect(isStellarAddress(validM)).toBe(true)
  })

  it('returns false for a lowercased Stellar address', () => {
    expect(isStellarAddress(validG.toLowerCase())).toBe(false)
  })

  it('returns false for an Ethereum-style hex address', () => {
    expect(isStellarAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false)
  })

  it('returns false for an address that is too short', () => {
    expect(isStellarAddress('GABC')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isStellarAddress('')).toBe(false)
  })

  it('returns false for a G address one character too long', () => {
    expect(isStellarAddress(validG + 'A')).toBe(false)
  })

  it('returns false for a muxed address one character too long', () => {
    expect(isStellarAddress(validM + 'A')).toBe(false)
  })

  it('returns false for a muxed address one character too short', () => {
    expect(isStellarAddress(validM.slice(0, -1))).toBe(false)
  })

  // ── #66: base32 excludes 0, 1, 8, 9 — a regression the previous
  // [A-Z0-9] pattern (still used in useNotifications.ts before this fix)
  // wrongly admitted. ───────────────────────────────────────────────────
  it.each(['0', '1', '8', '9'])(
    'returns false for an otherwise-valid G address containing "%s" (not a base32 character)',
    (digit) => {
      const withInvalidDigit = validG.slice(0, 5) + digit + validG.slice(6)
      expect(withInvalidDigit).toHaveLength(validG.length)
      expect(isStellarAddress(withInvalidDigit)).toBe(false)
    },
  )

  it.each(['0', '1', '8', '9'])(
    'returns false for an otherwise-valid muxed address containing "%s" (not a base32 character)',
    (digit) => {
      const withInvalidDigit = validM.slice(0, 5) + digit + validM.slice(6)
      expect(withInvalidDigit).toHaveLength(validM.length)
      expect(isStellarAddress(withInvalidDigit)).toBe(false)
    },
  )
})

describe('validateStellarAddress', () => {
  const validG = 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3MQAXRWUDX'
  const validC = 'CA7QYNF7SOWQ3GLR2BGMZEHXR73EWBMGM7OPKJNNOHHEJLBSXMZPQNUD'
  const validM = 'MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

  it('returns valid=true for canonical G address', () => {
    expect(validateStellarAddress(validG)).toEqual({ valid: true })
  })

  it('returns valid=true for canonical C address', () => {
    expect(validateStellarAddress(validC)).toEqual({ valid: true })
  })

  it('returns valid=true for valid muxed M address', () => {
    const validM = 'MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    expect(validateStellarAddress(validM)).toEqual({ valid: true })
  })

  it('returns specific error for empty address', () => {
    expect(validateStellarAddress('')).toEqual({ valid: false, error: 'Address is required' })
  })

  it('returns specific error for too-short address', () => {
    expect(validateStellarAddress('GABC')).toEqual({ valid: false, error: 'Address is too short' })
  })

  it('returns specific error for too-long address', () => {
    // G address with extra chars gets specific G/C length error (more helpful)
    expect(validateStellarAddress(validG + 'AAAA')).toEqual({
      valid: false,
      error: 'G/C address must be exactly 56 characters',
    })
  })

  it('returns specific error for G address with wrong length', () => {
    // Too short gets generic "too short" error (caught before G/C-specific check)
    expect(validateStellarAddress(validG.slice(0, -1))).toEqual({
      valid: false,
      error: 'Address is too short',
    })
  })

  it('returns specific error for muxed address with wrong length', () => {
    expect(validateStellarAddress(validM.slice(0, -1))).toEqual({
      valid: false,
      error: 'Muxed address must be exactly 69 characters',
    })
  })

  it('returns specific error for lowercase address', () => {
    expect(validateStellarAddress(validG.toLowerCase())).toEqual({
      valid: false,
      error: 'Address must be uppercase',
    })
  })

  it('returns specific error for invalid base32 characters', () => {
    const withZero = validG.slice(0, 5) + '0' + validG.slice(6)
    expect(validateStellarAddress(withZero)).toEqual({
      valid: false,
      error: 'Address contains invalid characters (0, 1, 8, 9 are not valid in base32)',
    })
  })

  it('returns specific error for invalid prefix', () => {
    expect(validateStellarAddress('X' + validG.slice(1))).toEqual({
      valid: false,
      error: 'Address must start with G (account), C (contract), or M (muxed)',
    })
  })
})
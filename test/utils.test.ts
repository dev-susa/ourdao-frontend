import { describe, expect, it } from 'vitest'
import { formatFileSize, formatToken, parseToken, formatThreshold, computeMaxLoan } from '@/lib/utils'

describe('formatToken', () => {
  it('renders a bare "0" for an exact zero value', () => {
    expect(formatToken(BigInt(0))).toBe('0')
  })

  it('does not render a non-zero sub-display-precision value as bare "0" (#61)', () => {
    // 999 stroops = 0.0000999 tokens at 7 decimals — below the 4-digit
    // display precision, but not actually zero.
    expect(formatToken(BigInt(999))).not.toBe('0')
    expect(formatToken(BigInt(999))).toBe('<0.0001')
  })

  it('renders a value exactly at the display-precision boundary normally', () => {
    // 1000 stroops = 0.0001 tokens — exactly representable at 4 display digits.
    expect(formatToken(BigInt(1000))).toBe('0.0001')
  })

  it('trims trailing fractional zeros', () => {
    // 5000000 stroops = 0.5 tokens.
    expect(formatToken(BigInt(5000000))).toBe('0.5')
  })

  it('handles large values above Number.MAX_SAFE_INTEGER without precision loss', () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) * BigInt(1000) + BigInt(1234567)
    // Full display precision (7) so nothing is deliberately rounded away —
    // this is a precision-loss check, not a display-rounding check.
    const formatted = formatToken(huge, { displayDecimals: 7 })
    // Round-tripping at full display precision must recover the exact value —
    // this would silently fail if formatToken had gone through `Number`.
    expect(parseToken(formatted, 7)).toBe(huge)
  })

  it('renders negative values with a leading "-", including the sub-precision case', () => {
    expect(formatToken(BigInt(-5000000))).toBe('-0.5')
    expect(formatToken(BigInt(-999))).toBe('-<0.0001')
  })

  it('respects an explicit displayDecimals rather than the hardcoded 4', () => {
    expect(formatToken(BigInt(999), { displayDecimals: 7 })).toBe('0.0000999')
    expect(formatToken(BigInt(1), { displayDecimals: 0 })).toBe('<1')
  })

  it('respects an explicit decimals (token precision) independent of displayDecimals', () => {
    // 2 decimals of precision, value 150 -> 1.50 -> trimmed to "1.5".
    expect(formatToken(BigInt(150), { decimals: 2 })).toBe('1.5')
  })
})

describe('formatToken / parseToken round trip', () => {
  const cases: Array<[label: string, value: bigint]> = [
    ['zero', BigInt(0)],
    ['sub-display-precision', BigInt(999)],
    ['exact display-precision boundary', BigInt(1000)],
    ['a whole number', BigInt(5) * BigInt(10) ** BigInt(7)],
    ['large (above Number.MAX_SAFE_INTEGER)', BigInt(Number.MAX_SAFE_INTEGER) * BigInt(1000) + BigInt(1)],
    ['negative', BigInt(-1234567)],
  ]

  it.each(cases)('round-trips %s losslessly at full display precision', (_label, value) => {
    const formatted = formatToken(value, { displayDecimals: 7 })
    expect(parseToken(formatted, 7)).toBe(value)
  })

  it('does NOT round-trip losslessly at reduced display precision (by design — display rounding is lossy)', () => {
    const value = BigInt(999) // 0.0000999, below default 4-digit display precision
    const formatted = formatToken(value)
    expect(formatted).toBe('<0.0001')
    // parseToken can't recover a value from the "<0.0001" placeholder — it
    // falls back to its documented zero default, which is the expected,
    // intentional lossy behavior of display-precision rounding.
    expect(parseToken(formatted, 7)).toBe(BigInt(0))
  })
})

describe('formatThreshold', () => {
  it('formats a whole-number basis-points value without trailing zeros', () => {
    expect(formatThreshold(5100)).toBe('51%')
  })

  it('formats a fractional basis-points value with two decimals', () => {
    expect(formatThreshold(5150)).toBe('51.50%')
  })

  it('formats zero as "0%"', () => {
    expect(formatThreshold(0)).toBe('0%')
  })

  it('formats a value that yields one decimal place', () => {
    expect(formatThreshold(515)).toBe('5.15%')
  })
})

describe('formatFileSize', () => {
  it('returns "0 Bytes" for zero', () => {
    expect(formatFileSize(0)).toBe('0 Bytes')
  })

  it('formats bytes under 1KB', () => {
    expect(formatFileSize(512)).toBe('512 Bytes')
  })

  it('formats exactly 1KB', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
  })

  it('formats 1.5KB', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB')
  })

  it('rounds to two decimal places', () => {
    // 1500 bytes = 1.464... KB -> 1.46 KB
    expect(formatFileSize(1500)).toBe('1.46 KB')
  })
})

describe('computeMaxLoan', () => {
  it('applies the policy ratio (basis points) to the treasury balance', () => {
    expect(computeMaxLoan(BigInt(5_000), 2000)).toBe(BigInt(1_000))
  })
  it('floors like the contract\'s integer division', () => {
    expect(computeMaxLoan(BigInt(9_999), 1)).toBe(BigInt(0))
  })
  it('is zero for an empty treasury or a zero ratio', () => {
    expect(computeMaxLoan(BigInt(0), 2000)).toBe(BigInt(0))
    expect(computeMaxLoan(BigInt(5_000), 0)).toBe(BigInt(0))
  })
})

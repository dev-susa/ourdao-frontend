// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useResponsiveCardLayout } from '@/lib/responsive'

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  })
  // also need to dispatch resize? The hook's recompute is triggered via matchMedia
  // change listeners, but initial mount uses getInitialBreakpoint which reads
  // window.innerWidth directly, so setting innerWidth before mount is enough
  // as long as we ensure cachedState is recomputed on next subscription.
  // Force a resize event to trigger subscribers if any remain
  window.dispatchEvent(new Event('resize'))
}

describe('useResponsiveCardLayout.getCardGridClass', () => {
  beforeEach(() => {
    // jsdom matchMedia is stubbed in setup.ts to no-op; ensure innerWidth
    // is reset and global cache is cleared by unmounting previous hooks
    // (renderHook cleanup handles unsubscription)
  })

  it('sm breakpoint always returns grid-cols-1 regardless of itemCount', () => {
    setWidth(500) // <640 => sm
    const { result } = renderHook(() => useResponsiveCardLayout())
    expect(result.current.getCardGridClass(1)).toBe('grid-cols-1')
    expect(result.current.getCardGridClass(2)).toBe('grid-cols-1')
    expect(result.current.getCardGridClass(5)).toBe('grid-cols-1')
  })

  it('md breakpoint varies with itemCount (1 -> 1 col, 2+ -> 2 cols)', () => {
    setWidth(700) // 640-767 => md
    const { result } = renderHook(() => useResponsiveCardLayout())
    expect(result.current.getCardGridClass(1)).toBe('grid-cols-1')
    expect(result.current.getCardGridClass(2)).toBe('grid-cols-2')
    expect(result.current.getCardGridClass(3)).toBe('grid-cols-2')
    expect(result.current.getCardGridClass(10)).toBe('grid-cols-2')
  })

  it('md branch is not a dead ternary (the two branches differ)', () => {
    setWidth(700)
    const { result } = renderHook(() => useResponsiveCardLayout())
    const one = result.current.getCardGridClass(1)
    const many = result.current.getCardGridClass(3)
    expect(one).not.toBe(many)
  })

  it('lg breakpoint scales with itemCount', () => {
    setWidth(900) // 768-1023 => lg
    const { result } = renderHook(() => useResponsiveCardLayout())
    expect(result.current.getCardGridClass(1)).toBe('grid-cols-2')
    expect(result.current.getCardGridClass(2)).toBe('grid-cols-2')
    expect(result.current.getCardGridClass(3)).toBe('grid-cols-3')
    expect(result.current.getCardGridClass(4)).toBe('grid-cols-4')
    expect(result.current.getCardGridClass(10)).toBe('grid-cols-4')
  })

  it('xl/2xl use the same lg scaling', () => {
    setWidth(1300) // >=1280 => 2xl, still falls into else branch
    const { result } = renderHook(() => useResponsiveCardLayout())
    expect(result.current.getCardGridClass(1)).toBe('grid-cols-2')
    expect(result.current.getCardGridClass(3)).toBe('grid-cols-3')
    expect(result.current.getCardGridClass(4)).toBe('grid-cols-4')
  })
})

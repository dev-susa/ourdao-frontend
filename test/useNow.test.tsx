// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useNow, getSnapshot } from '@/hooks/useNow'

function Probe() {
  const now = useNow()
  return <div>{now === null ? 'unknown' : 'ready'}</div>
}

describe('useNow', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders without throwing', () => {
    expect(() => render(<Probe />)).not.toThrow()
    expect(screen.getByText(/unknown|ready/)).toBeTruthy()
  })

  // This is the actual invariant that broke: getSnapshot originally called
  // Date.now() directly, so its return value tracked the real clock on
  // every call. useSyncExternalStore requires getSnapshot to stay stable
  // between calls until the store itself notifies a change (here, the 30s
  // interval tick) — violating that made React see an always-"changed"
  // snapshot and re-render forever chasing it in a real browser (React
  // error #185, Maximum update depth exceeded).
  //
  // Two immediate calls to Date.now() often land in the same millisecond
  // anyway, so asserting on that directly would be flaky. Fake timers make
  // it deterministic: advance the clock without firing the interval, and
  // getSnapshot must still return the same value both times.
  it('getSnapshot does not change just because time passed — only the interval tick updates it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const a = getSnapshot()
    vi.setSystemTime(50_000) // 49s later, well past a real Date.now() call would differ, but the 30s interval hasn't been advanced/fired
    const b = getSnapshot()
    expect(a).toBe(b)
  })
})

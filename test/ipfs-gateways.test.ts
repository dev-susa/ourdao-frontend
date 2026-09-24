import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function bytesResponse(bytes: Uint8Array, ok = true, status = ok ? 200 : 500) {
  return { ok, status, arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Response
}

describe('downloadFromIPFS gateway fallback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_IPFS_GATEWAY', 'https://one.example/ipfs/,https://two.example/ipfs/')
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  async function load() {
    return import('@/lib/ipfs')
  }

  it('returns from the first gateway without touching the second when it succeeds', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(bytesResponse(new TextEncoder().encode('ok')))
    const { downloadFromIPFS } = await load()

    const res = await downloadFromIPFS('QmHash')

    expect(new TextDecoder().decode(res.content)).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://one.example/ipfs/QmHash')
  })

  it('falls back to the next gateway on a non-2xx response', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(bytesResponse(new Uint8Array(), false, 429))
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode('second')))
    const { downloadFromIPFS } = await load()

    const res = await downloadFromIPFS('QmHash')

    expect(new TextDecoder().decode(res.content)).toBe('second')
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('https://two.example/ipfs/QmHash')
  })

  it('falls back on a network error or timeout, passing an abort signal to each request', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
      .mockResolvedValueOnce(bytesResponse(new TextEncoder().encode('second')))
    const { downloadFromIPFS } = await load()

    await downloadFromIPFS('QmHash')

    for (const [, init] of vi.mocked(fetch).mock.calls) {
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
    }
  })

  it('throws the last error once every gateway has failed', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(bytesResponse(new Uint8Array(), false, 503))
      .mockResolvedValueOnce(bytesResponse(new Uint8Array(), false, 404))
    const { downloadFromIPFS } = await load()

    await expect(downloadFromIPFS('QmHash')).rejects.toThrow(/404/)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backend, BackendError, isBackendConfigured } from '@/lib/backend'

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) } as Response
}

const CONFIGURED_URL = 'http://localhost:4000'

/** A complete, valid /api/stats body — `getStats` validates the whole shape. */
const statsFixture = {
  totalMembers: 5,
  activeMembers: 4,
  totalLoanProposals: 2,
  totalLoans: 1,
  activeLoans: 1,
  defaultedLoans: 0,
  totalTreasuryProposals: 0,
  totalStaked: '0',
  lastIndexedLedger: 42,
  secondsSinceUpdate: 1,
  indexerStale: false,
  totalDefaultedValue: '0',
  interestCollected: '0',
  principalLent: '0',
  principalRepaid: '0',
  valueDefaulted: '0',
}

describe('backend fetch wrappers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', CONFIGURED_URL)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('getStats fetches /api/stats and returns the parsed body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(statsFixture))
    const result = await backend.getStats()
    expect(fetch).toHaveBeenCalledWith(`${CONFIGURED_URL}/api/stats`, expect.objectContaining({ cache: 'no-store' }))
    expect(result).toEqual(statsFixture)
  })

  it('getStats rejects with a BackendError when the response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503 } as Response)
    await expect(backend.getStats()).rejects.toMatchObject({
      name: 'BackendError',
      status: 503,
    })
  })

  it('getStats rejects with a BackendError when fetch itself throws (backend unreachable)', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'))
    await expect(backend.getStats()).rejects.toBeInstanceOf(BackendError)
  })

  it('getStats rejects with a BackendError when the body is not valid JSON (#363)', async () => {
    // A proxy error page can answer HTTP 200 with HTML; that must surface as a
    // BackendError rather than a raw SyntaxError, so the consumer's error state
    // stands in for "the indexer changed shape".
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
    } as unknown as Response)
    await expect(backend.getStats()).rejects.toMatchObject({
      name: 'BackendError',
      status: null,
    })
  })

  it('getMembers returns the active member directory (#395)', async () => {
    const row = {
      address: 'GAAA',
      joined_ledger: 42,
      contribution: '0',
      exited: false,
      exit_share: null,
      exited_ledger: null,
      pending_claimed: '0',
      stake: '10000000000',
      has_active_loan: false,
      name: 'Alice',
      defaults_count: 0,
      updated_at: '2026-01-01T00:00:00Z',
    }
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([row]))
    await expect(backend.getMembers(10)).resolves.toEqual([row])
    expect(fetch).toHaveBeenCalledWith(
      `${CONFIGURED_URL}/api/members?limit=10`,
      expect.objectContaining({ cache: 'no-store' })
    )
  })

  it('getMembers rejects a row with a missing required field (#395)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([{ address: 'GAAA' }]))
    await expect(backend.getMembers()).rejects.toBeInstanceOf(BackendError)
  })

  it('aborts request when external signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort(new Error('User aborted'))
    vi.mocked(fetch).mockImplementationOnce((_url, init) => {
      const signal = init?.signal as AbortSignal | undefined
      if (signal?.aborted) {
        return Promise.reject(new Error('The operation was aborted'))
      }
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
      })
    })

    await expect(backend.getStats({ signal: controller.signal })).rejects.toBeInstanceOf(BackendError)
  })

  it('aborts request when timeout is reached', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(fetch).mockImplementationOnce((_url, init) => {
        const signal = init?.signal as AbortSignal | undefined
        return new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(new Error(signal.reason?.message ?? 'aborted')))
        })
      })

      const promise = backend.getStats({ timeoutMs: 100 })
      vi.advanceTimersByTime(150)
      await expect(promise).rejects.toBeInstanceOf(BackendError)
    } finally {
      vi.useRealTimers()
    }
  })

  it('getLoans without a borrower hits /api/loans with no query string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]))
    await backend.getLoans()
    expect(fetch).toHaveBeenCalledWith(`${CONFIGURED_URL}/api/loans`, expect.anything())
  })

  it('getLoans with a borrower URL-encodes it into the query string', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]))
    await backend.getLoans('GA BC') // space to prove encoding happens
    expect(fetch).toHaveBeenCalledWith(
      `${CONFIGURED_URL}/api/loans?borrower=GA%20BC`,
      expect.anything()
    )
  })

  it('getLoans rejects on failure instead of returning an empty list that looks like "no loans"', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(null, false))
    await expect(backend.getLoans()).rejects.toBeInstanceOf(BackendError)
  })

  it('getLoans resolves to an empty array when the backend is not configured (preview mode)', async () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', '')
    expect(await backend.getLoans()).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('getLoans rejects when any loan row has the wrong shape, rather than showing an empty list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([{ id: 1, borrower: 'G', status: 'pending' }]))
    await expect(backend.getLoans()).rejects.toBeInstanceOf(BackendError)
  })

  it('getEvents composes symbol + limit query params', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]))
    await backend.getEvents(25, 'loan_req')
    expect(fetch).toHaveBeenCalledWith(
      `${CONFIGURED_URL}/api/events?symbol=loan_req&limit=25`,
      expect.anything()
    )
  })

  it('getEvents rejects when the event response shape drifts', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([{ id: 1, ledger: 'not-a-number' }]))
    await expect(backend.getEvents()).rejects.toBeInstanceOf(BackendError)
  })

  it('getAdminLog hits /api/admin/log with the limit', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse([]))
    await backend.getAdminLog(10)
    expect(fetch).toHaveBeenCalledWith(`${CONFIGURED_URL}/api/admin/log?limit=10`, expect.anything())
  })

  describe('authenticated notification mutations (#306)', () => {
    const ADDRESS = 'GALICE'
    const NONCE = 'a'.repeat(64)
    const SIGNATURE = 'c2lnbmF0dXJl'
    const signer = { address: ADDRESS, signMessage: vi.fn(async () => SIGNATURE) }

    beforeEach(() => {
      signer.signMessage.mockClear()
    })

    /** The handshake is two requests: the challenge, then the PATCH. */
    const mockChallengeThen = (patchResponse: Partial<Response>) =>
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ nonce: NONCE }))
        .mockResolvedValueOnce({ ok: true, status: 200, ...patchResponse } as Response)

    it('signs "<nonce>:<address>" and sends the header the backend parses', async () => {
      mockChallengeThen({})

      const result = await backend.markNotificationRead(42, signer)

      expect(signer.signMessage).toHaveBeenCalledWith(`${NONCE}:${ADDRESS}`)
      expect(result).toEqual({ ok: true, status: 200 })
      const [, init] = vi.mocked(fetch).mock.calls[1]
      expect(init?.method).toBe('PATCH')
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        `StellarSignature ${ADDRESS}:${SIGNATURE}:${NONCE}`
      )
    })

    it('a 401 is reported as unauthorized with the backend\'s own reason, not as success', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ nonce: NONCE }))
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Invalid or expired nonce' }),
        } as Response)

      await expect(backend.markNotificationRead(1, signer)).resolves.toEqual({
        ok: false,
        status: 401,
        reason: 'unauthorized',
        message: 'Invalid or expired nonce',
      })
    })

    it('a 403 (another address\'s notification) is distinguished from a 401', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ nonce: NONCE }))
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          json: () => Promise.resolve({ error: 'Cannot modify notifications for another address' }),
        } as Response)

      await expect(backend.markNotificationRead(1, signer)).resolves.toMatchObject({
        ok: false,
        reason: 'forbidden',
      })
    })

    it('a rejected signature prompt never reaches the PATCH at all', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ nonce: NONCE }))
      signer.signMessage.mockRejectedValueOnce(new Error('User declined'))

      await expect(backend.markNotificationRead(1, signer)).resolves.toMatchObject({
        ok: false,
        reason: 'rejected',
      })
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('a C… account is refused locally, without a pointless signature prompt', async () => {
      const contractSigner = { address: 'CCONTRACT', signMessage: signer.signMessage }
      signer.signMessage.mockClear()

      await expect(backend.markNotificationRead(1, contractSigner)).resolves.toMatchObject({
        ok: false,
        reason: 'unsupported-address',
      })
      expect(signer.signMessage).not.toHaveBeenCalled()
      expect(fetch).not.toHaveBeenCalled()
    })

    it('an unreachable backend during the handshake is "unavailable", not a rejection', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))

      await expect(backend.markNotificationRead(1, signer)).resolves.toMatchObject({
        ok: false,
        reason: 'unavailable',
      })
    })

    it('reports failure when no backend is configured, instead of pretending it saved', async () => {
      vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', '')

      await expect(backend.markNotificationRead(1, signer)).resolves.toMatchObject({
        ok: false,
        reason: 'unavailable',
      })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('markAllNotificationsRead URL-encodes the address and signs for that same address', async () => {
      mockChallengeThen({})
      const spaced = { address: 'GA BC', signMessage: signer.signMessage }

      await backend.markAllNotificationsRead('GA BC', spaced)

      expect(signer.signMessage).toHaveBeenCalledWith(`${NONCE}:GA BC`)
      const [url] = vi.mocked(fetch).mock.calls[1]
      expect(url).toBe(`${CONFIGURED_URL}/api/notifications/read-all?address=GA%20BC`)
    })
  })
})

describe('isBackendConfigured', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('returns false when NEXT_PUBLIC_BACKEND_URL is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', '')
    expect(isBackendConfigured()).toBe(false)
    // Also verify that BACKEND_URL export is empty when unset at import time?
    // The static export was evaluated with whatever env was at import, but the
    // function is dynamic, so we test the function.
  })

  it('returns true when NEXT_PUBLIC_BACKEND_URL is set', () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', CONFIGURED_URL)
    expect(isBackendConfigured()).toBe(true)
  })

  it('does not make a network request when unconfigured', async () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', '')
    vi.stubGlobal('fetch', vi.fn())
    const result = await backend.getStats()
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('renders degraded empty state without network request when unconfigured', async () => {
    vi.stubEnv('NEXT_PUBLIC_BACKEND_URL', '')
    vi.stubGlobal('fetch', vi.fn())
    expect(await backend.getLoans()).toEqual([])
    expect(await backend.getEvents()).toEqual([])
    expect(await backend.getNotifications('GALICE')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDocumentContent } from '@/hooks/useDocument'
import type { DocumentMetadata } from '@/lib/ipfs'

const mockDownloadFromIPFS = vi.fn()
const mockCanAccessDocument = vi.fn()

vi.mock('@/lib/ipfs', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ipfs')>('@/lib/ipfs')
  return {
    ...actual,
    downloadFromIPFS: (...args: unknown[]) => mockDownloadFromIPFS(...args),
    canAccessDocument: (...args: unknown[]) => mockCanAccessDocument(...args),
  }
})

const doc = (over: Partial<DocumentMetadata> = {}): DocumentMetadata => ({
  name: 'report.pdf',
  type: 'application/pdf',
  size: 1024,
  uploadedAt: new Date('2026-01-01'),
  encrypted: false,
  hash: 'Qmhash',
  ...over,
})

function Harness({
  doc,
  onRender,
}: {
  doc: DocumentMetadata
  onRender: (hook: ReturnType<typeof useDocumentContent>) => void
}) {
  const hook = useDocumentContent(doc, 'GALICE', [])
  onRender(hook)
  return null
}

function renderHook(testDoc: DocumentMetadata, onRender: (hook: ReturnType<typeof useDocumentContent>) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Harness doc={testDoc} onRender={onRender} />
    </QueryClientProvider>
  )
}

describe('useDocumentContent', () => {
  beforeEach(() => {
    mockDownloadFromIPFS.mockReset()
    mockCanAccessDocument.mockReset().mockReturnValue(true)
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    })
  })
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads an unencrypted document automatically and exposes its content', async () => {
    const content = new TextEncoder().encode('hello world')
    mockDownloadFromIPFS.mockResolvedValue({ content, decrypted: false })

    let latest: ReturnType<typeof useDocumentContent> | undefined
    renderHook(doc(), (hook) => { latest = hook })

    await waitFor(() => expect(latest?.content).toBe(content))
    expect(latest?.loading).toBe(false)
    expect(latest?.error).toBe('')
    expect(latest?.previewUrl).toBe('blob:mock-url')
    expect(mockDownloadFromIPFS).toHaveBeenCalledWith('Qmhash', false)
  })

  it('reports access denied and never fetches when the user lacks access', async () => {
    mockCanAccessDocument.mockReturnValue(false)

    let latest: ReturnType<typeof useDocumentContent> | undefined
    renderHook(doc(), (hook) => { latest = hook })

    await waitFor(() => expect(latest?.error).toBe('You do not have permission to view this doc'))
    expect(latest?.content).toBeNull()
    expect(mockDownloadFromIPFS).not.toHaveBeenCalled()
  })

  it('surfaces a fetch failure as the error state', async () => {
    mockDownloadFromIPFS.mockRejectedValue(new Error('Failed to download document from IPFS'))

    let latest: ReturnType<typeof useDocumentContent> | undefined
    renderHook(doc(), (hook) => { latest = hook })

    await waitFor(() => expect(latest?.error).toBe('Failed to download document from IPFS'))
    expect(latest?.content).toBeNull()
  })

  it('surfaces a wrong decryption password as the error state', async () => {
    mockDownloadFromIPFS.mockRejectedValue(new Error('Failed to download document from IPFS'))

    let latest: ReturnType<typeof useDocumentContent> | undefined
    renderHook(doc({ encrypted: true }), (hook) => { latest = hook })

    // Encrypted docs don't auto-fetch.
    expect(mockDownloadFromIPFS).not.toHaveBeenCalled()

    await act(async () => {
      latest!.decrypt('wrong-password')
    })

    await waitFor(() => expect(latest?.error).toBe('Failed to download document from IPFS'))
    expect(latest?.content).toBeNull()
    expect(latest?.decrypted).toBe(false)
    expect(mockDownloadFromIPFS).toHaveBeenCalledWith('Qmhash', true, 'wrong-password')
  })

  it('decrypts successfully with the right password', async () => {
    const content = new TextEncoder().encode('secret plans')
    mockDownloadFromIPFS.mockResolvedValue({ content, decrypted: true })

    let latest: ReturnType<typeof useDocumentContent> | undefined
    renderHook(doc({ encrypted: true }), (hook) => { latest = hook })

    await act(async () => {
      latest!.decrypt('correct-password')
    })

    await waitFor(() => expect(latest?.content).toBe(content))
    expect(latest?.decrypted).toBe(true)
    expect(latest?.error).toBe('')
  })
})

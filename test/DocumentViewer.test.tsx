// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DocumentViewer from '@/components/DocumentViewer'
import type { DocumentMetadata } from '@/lib/ipfs'
import { useDocumentContent } from '@/hooks/useDocument'

vi.mock('@/hooks/useDocument', () => ({
  useDocumentContent: vi.fn(),
}))

const mockUseDocumentContent = vi.mocked(useDocumentContent)

const doc = (over: Partial<DocumentMetadata> = {}): DocumentMetadata => ({
  name: 'report.pdf',
  type: 'text/plain',
  size: 1024,
  uploadedAt: new Date('2026-01-01'),
  encrypted: false,
  hash: 'Qmhash',
  permissions: { public: true },
  ...over,
})

const hookResult = (over: Partial<ReturnType<typeof useDocumentContent>> = {}) => ({
  content: null,
  loading: false,
  error: '',
  decrypted: false,
  previewUrl: null,
  decrypt: vi.fn(),
  ...over,
})

describe('DocumentViewer', () => {
  beforeEach(() => {
    mockUseDocumentContent.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders access denied without calling the loader', () => {
    mockUseDocumentContent.mockReturnValue(hookResult())
    render(<DocumentViewer doc={doc({ permissions: { public: false } })} userAddress="GBOB" />)

    expect(screen.getByText('Access Denied')).toBeInTheDocument()
  })

  it('renders the loading state', () => {
    mockUseDocumentContent.mockReturnValue(hookResult({ loading: true }))
    render(<DocumentViewer doc={doc()} userAddress="GALICE" />)

    expect(screen.getByText('Loading document...')).toBeInTheDocument()
  })

  it('renders an error state', () => {
    mockUseDocumentContent.mockReturnValue(hookResult({ error: 'Failed to download document from IPFS' }))
    render(<DocumentViewer doc={doc()} userAddress="GALICE" />)

    expect(screen.getByText('Failed to download document from IPFS')).toBeInTheDocument()
  })

  it('renders decrypted content for a text document', () => {
    const content = new TextEncoder().encode('hello world')
    mockUseDocumentContent.mockReturnValue(
      hookResult({ content, decrypted: true, previewUrl: 'blob:mock' })
    )
    render(<DocumentViewer doc={doc({ encrypted: true })} userAddress="GALICE" />)

    expect(screen.getByText('Document decrypted successfully')).toBeInTheDocument()
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('renders the dark-mode classed tree without error', () => {
    mockUseDocumentContent.mockReturnValue(hookResult({ loading: true }))
    const { container } = render(
      <div className="dark">
        <DocumentViewer doc={doc()} userAddress="GALICE" />
      </div>
    )

    expect(container.querySelector('.dark')).not.toBeNull()
    expect(screen.getByText('Loading document...')).toBeInTheDocument()
  })
})

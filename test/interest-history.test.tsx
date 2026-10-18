// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './test-utils'
import { InterestHistory } from '@/components/InterestHistory'
import { backend } from '@/lib/backend'

vi.mock('@/lib/backend', () => ({
  backend: {
    isConfigured: () => true,
    getInterestDistributions: vi.fn(),
  },
}))

describe('InterestHistory component (Issue #398)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading skeleton when fetching', () => {
    vi.mocked(backend.getInterestDistributions).mockReturnValue(new Promise(() => {}))
    renderWithProviders(<InterestHistory />)
    expect(screen.getByText(/Interest Distribution History/i)).toBeInTheDocument()
  })

  it('renders empty state when no distributions exist', async () => {
    vi.mocked(backend.getInterestDistributions).mockResolvedValue([])
    renderWithProviders(<InterestHistory />)

    await waitFor(() => {
      expect(screen.getByText(/No interest distributions recorded yet/i)).toBeInTheDocument()
    })
  })

  it('renders table rows when distributions are returned', async () => {
    vi.mocked(backend.getInterestDistributions).mockResolvedValue([
      {
        id: 1,
        ledger: 123456,
        amount: '10000000', // 1 token
        active_members: 5,
        tx_hash: 'abcdef1234567890',
        created_at: '2026-03-01T12:00:00Z',
      },
      {
        id: 2,
        ledger: 123500,
        amount: '25000000', // 2.5 tokens
        active_members: 6,
        tx_hash: null,
        created_at: '2026-03-02T12:00:00Z',
      },
    ])

    renderWithProviders(<InterestHistory />)

    await waitFor(() => {
      expect(screen.getByTestId('interest-distributions-table')).toBeInTheDocument()
    })

    expect(screen.getByText('#123456')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('#123500')).toBeInTheDocument()
    expect(screen.getByText('+2.5')).toBeInTheDocument()
  })

  it('paginates using cursor when older button is clicked', async () => {
    const mockDataPage1 = Array.from({ length: 2 }, (_, i) => ({
      id: i + 1,
      ledger: 200 - i * 10,
      amount: '10000000',
      active_members: 4,
      tx_hash: 'hash',
      created_at: '2026-03-01T12:00:00Z',
    }))

    vi.mocked(backend.getInterestDistributions).mockResolvedValue(mockDataPage1)

    renderWithProviders(<InterestHistory pageSize={2} />)

    const olderBtn = await screen.findByRole('button', { name: /Older/i })
    expect(olderBtn).not.toBeDisabled()

    fireEvent.click(olderBtn)

    await waitFor(() => {
      expect(backend.getInterestDistributions).toHaveBeenCalledWith({
        before: 190,
        limit: 2,
      })
    })
  })
})

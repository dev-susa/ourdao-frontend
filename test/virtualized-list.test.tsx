// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { VirtualizedList } from '@/components/ui/virtualized-list'

describe('VirtualizedList component (#244)', () => {
  it('renders all items directly when list length is at or below threshold', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, name: `Proposal #${i + 1}` }))

    render(
      <VirtualizedList
        items={items}
        threshold={50}
        keyExtractor={(item) => item.id}
        renderItem={(item) => <div>{item.name}</div>}
        listAriaLabel="Proposals"
      />
    )

    const listElement = screen.getByRole('list', { name: 'Proposals' })
    expect(listElement).toHaveAttribute('data-virtualized', 'false')

    const listItems = screen.getAllByRole('listitem')
    expect(listItems).toHaveLength(20)
    expect(listItems[0]).toHaveAttribute('aria-setsize', '20')
    expect(listItems[0]).toHaveAttribute('aria-posinset', '1')
    expect(listItems[19]).toHaveAttribute('aria-posinset', '20')
  })

  it('bounds DOM nodes when list length exceeds threshold (e.g. 200 rows ceiling)', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: `Row #${i + 1}` }))

    render(
      <VirtualizedList
        items={items}
        threshold={50}
        itemHeight={100}
        overscan={5}
        keyExtractor={(item) => item.id}
        renderItem={(item) => <div>{item.name}</div>}
        listAriaLabel="Large Dataset"
      />
    )

    const listElement = screen.getByRole('list', { name: 'Large Dataset' })
    expect(listElement).toHaveAttribute('data-virtualized', 'true')

    const listItems = screen.getAllByRole('listitem')
    // DOM nodes are bounded to window + overscan rather than 200
    expect(listItems.length).toBeLessThan(50)
    expect(listItems.length).toBeGreaterThan(0)

    // Screen reader attributes reflect total dataset size
    expect(listItems[0]).toHaveAttribute('aria-setsize', '200')
    expect(listItems[0]).toHaveAttribute('aria-posinset')
  })

  it('preserves keyboard access and ARIA semantics', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, title: `Item ${i + 1}` }))

    render(
      <VirtualizedList
        items={items}
        threshold={30}
        keyExtractor={(item) => item.id}
        renderItem={(item) => <button type="button">{item.title}</button>}
        listAriaLabel="Accessible List"
      />
    )

    const listElement = screen.getByRole('list', { name: 'Accessible List' })
    expect(listElement).toHaveAttribute('tabIndex', '0')

    const firstButton = screen.getByRole('button', { name: 'Item 1' })
    expect(firstButton).toBeInTheDocument()
  })
})

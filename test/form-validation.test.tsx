// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormErrorSummary } from '@/components/FormErrorSummary'
import { compactErrors, positiveTokenAmount, required, stellarAddress } from '@/lib/form-validation'

describe('shared form validation', () => {
  it('builds reusable required, amount, and Stellar address errors', () => {
    const errors = compactErrors([
      required('', 'reason', 'Reason'),
      positiveTokenAmount('0', 'amount', 'Amount'),
      stellarAddress('not-an-address', 'destination', 'Destination address'),
    ])

    expect(errors).toEqual([
      { field: 'reason', message: 'Reason is required' },
      { field: 'amount', message: 'Amount must be greater than zero' },
      { field: 'destination', message: 'Destination address must be a valid Stellar address' },
    ])
  })

  it('renders an accessible linked error summary', () => {
    render(
      <FormErrorSummary
        errors={[
          { field: 'proposal-amount', message: 'Amount must be greater than zero' },
          { field: 'proposal-reason', message: 'Reason is required' },
        ]}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Fix the following')
    expect(screen.getByRole('link', { name: 'Amount must be greater than zero' })).toHaveAttribute(
      'href',
      '#proposal-amount'
    )
    expect(screen.getByRole('link', { name: 'Reason is required' })).toHaveAttribute(
      'href',
      '#proposal-reason'
    )
  })
})

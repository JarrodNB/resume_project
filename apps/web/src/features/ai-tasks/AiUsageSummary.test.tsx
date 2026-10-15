/**
 * Description: Monthly cost display distinguishes known spend from missing request costs.
 * Index:
 *   - tests: real hook/query/subscription rendering using synthetic Apollo responses
 */
import { MockedProvider } from '@apollo/client/testing/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AiUsageSummary } from './AiUsageSummary'
import { AI_USAGE_OWNER, AI_USAGE_UPDATED } from './aiUsageOperations'

describe('AiUsageSummary', () => {
  it('shows known costs with an incomplete-accounting notice', async () => {
    render(<MockedProvider mocks={[
      { request: { query: AI_USAGE_OWNER }, result: { data: { me: { __typename: 'User', id: 'owner' } } } },
      { request: { query: AI_USAGE_UPDATED, variables: { userId: 'owner' } }, result: { data: {
        aiUsageUpdated: { __typename: 'AiUsage', spentThisMonthUsd: 0.000035, monthlyBudgetUsd: 5,
          incompleteAttempts: 1, resetsAt: '2026-11-01T00:00:00Z' },
      } } },
    ]}><AiUsageSummary /></MockedProvider>)
    expect(await screen.findByText('Known AI cost this month: $0.000035 / $5.00')).toBeInTheDocument()
    expect(screen.getByText('Some request costs are unknown; actual spend may be higher.')).toBeInTheDocument()
  })
})

/** Delayed stage saves show progress and recover after either server outcome. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MockedProvider } from '@apollo/client/testing/react'
import { expect, it } from 'vitest'
import { JobStageSelect } from './JobStageSelect'
import { MOVE_JOB_TO_STAGE_MUTATION } from './jobsOperations'

it.each([false, true])('explains a pending stage save and clears it (failure: %s)', async (fails) => {
  render(<MockedProvider mocks={[{
    request: { query: MOVE_JOB_TO_STAGE_MUTATION, variables: { id: 'job-1', stage: 'APPLIED' } },
    delay: 100,
    result: { data: { moveJobToStage: { __typename: 'MoveJobToStagePayload', errors: fails ? ['Could not save stage'] : [] } } },
  }]}><JobStageSelect jobId="job-1" stage="UNAPPLIED" /></MockedProvider>)
  const stage = screen.getByRole('combobox', { name: 'Stage' })
  fireEvent.change(stage, { target: { value: 'APPLIED' } })
  expect(screen.getByRole('status')).toHaveTextContent('Saving stage…')
  expect(stage).toBeDisabled()
  await waitFor(() => expect(stage).toBeEnabled())
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  if (fails) expect(screen.getByRole('alert')).toHaveTextContent('Could not save stage')
  else expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

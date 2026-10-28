/** Exercise reviewed answer copies through the actual Career context mutation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MockedProvider } from '@apollo/client/testing/react'
import type { MockLink } from '@apollo/client/testing'
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'
import { CREATE_CAREER_CONTEXT_MUTATION } from '@/features/career-library/careerLibrarySaveMutations'
import { SaveInterviewAnswer } from './SaveInterviewAnswer'

type Message = InterviewSnapshotFragment['messages'][number]
function message(values: Partial<Message> = {}): Message {
  return { id: 'answer', questionId: 'core', position: 2, kind: 'answer', content: 'Reduced processing time.',
    acknowledgement: null, spokenContent: '', avoided: false, careerReferences: null, clarification: null, ...values }
}
function show(answer = message(), prompts = [message({ id: 'prompt', position: 1, kind: 'opening', content: 'Describe an improvement.' })], mocks: MockLink.MockedResponse[] = []) {
  const interview = { messages: [...prompts, answer] } as InterviewSnapshotFragment
  return render(<MockedProvider mocks={mocks}><SaveInterviewAnswer interview={interview} message={answer} /></MockedProvider>)
}
function saveMock(requirement = 'Describe an improvement.', response = 'Reduced processing time.', errors: string[] = [], delay = 0) {
  const result = vi.fn(() => ({ data: { createCareerContext: { __typename: 'CreateCareerContextPayload', errors } } }))
  return { request: { query: CREATE_CAREER_CONTEXT_MUTATION, variables: { attributes: { requirement, response } } }, result, delay }
}
async function open() { await userEvent.click(screen.getByRole('button', { name: 'Save to Career context' })) }
async function submit() { await userEvent.click(screen.getByRole('button', { name: 'Save' })) }
afterEach(cleanup)

describe('SaveInterviewAnswer', () => {
  it('saves only edited approved text, shows success and leaves the source unchanged', async () => {
    const answer = message(), saved = saveMock('Inventory improvement', 'Saved two hours a week.')
    show(answer, undefined, [saved])
    await open()
    fireEvent.change(screen.getByLabelText('Requirement'), { target: { value: 'Inventory improvement' } })
    fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'Saved two hours a week.' } })
    await submit()
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to Career context.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(saved.result).toHaveBeenCalledOnce()
    expect(answer.content).toBe('Reduced processing time.')
  })
  it('cancels without submitting and reopens the original preview', async () => {
    const saved = saveMock()
    show(undefined, undefined, [saved])
    await open()
    fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'draft edit' } })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(saved.result).not.toHaveBeenCalled()
    await open()
    expect(screen.getByLabelText('Response')).toHaveValue('Reduced processing time.')
  })
  it.each(['Requirement has already been taken', 'You can save up to 100 notes'])('preserves edits and allows recovery: %s', async (error) => {
    const saved = saveMock(undefined, 'Edited answer', [error]), retry = saveMock('Different topic', 'Edited answer')
    show(undefined, undefined, [saved, retry])
    await open()
    fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'Edited answer' } })
    await submit()
    expect(await screen.findByText(error)).toBeVisible()
    expect(screen.getByLabelText('Response')).toHaveValue('Edited answer')
    fireEvent.change(screen.getByLabelText('Requirement'), { target: { value: 'Different topic' } })
    await submit()
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to Career context.')
  })
  it('retains edits after a network error and allows retry', async () => {
    const retry = saveMock()
    show(undefined, undefined, [{ request: retry.request, error: new Error('Offline') }, retry])
    await open()
    await submit()
    expect(await screen.findByText('Could not reach the server. Please try again.')).toBeVisible()
    expect(screen.getByLabelText('Response')).toHaveValue('Reduced processing time.')
    await submit()
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to Career context.')
  })
  it('protects pending submission and keeps the preview open until confirmation', async () => {
    const saved = saveMock(undefined, undefined, [], 100)
    show(undefined, undefined, [saved])
    await open()
    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to Career context.')
    expect(saved.result).toHaveBeenCalledOnce()
  })
  it('retains overlong source text and requires editing before saving', async () => {
    const prompt = 'q'.repeat(1001), response = 'a'.repeat(4001), saved = saveMock('Short topic', 'Short answer')
    show(message({ content: response }), [message({ id: 'prompt', kind: 'opening', position: 1, content: prompt })], [saved])
    await open()
    expect(screen.getByLabelText('Requirement')).toHaveValue(prompt)
    expect(screen.getByLabelText('Response')).toHaveValue(response)
    await submit()
    expect(await screen.findByText(/Requirement must be 1000 characters/)).toBeVisible()
    expect(screen.getByText(/Response must be 4000 characters/)).toBeVisible()
    expect(saved.result).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Requirement'), { target: { value: 'Short topic' } })
    fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'Short answer' } })
    await submit()
    expect(await screen.findByRole('status')).toHaveTextContent('Saved to Career context.')
  })
  it.each([{ kind: 'opening' }, { kind: 'follow_up' }, { kind: 'closing' }, { content: '' }, { content: '   ' }, { content: '[expired]' }])('excludes unavailable/non-answer content %j', (values) => {
    show(message(values))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('does not use a question from another core or from after the answer', () => {
    show(message(), [message({ kind: 'opening', questionId: 'other', position: 1 }), message({ kind: 'follow_up', position: 3 })])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
  it('does not fall back to an older prompt when the actual follow-up expired', () => {
    show(message({ position: 4 }), [message({ kind: 'opening', position: 1 }), message({ kind: 'follow_up', position: 3, content: '[expired]' })])
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

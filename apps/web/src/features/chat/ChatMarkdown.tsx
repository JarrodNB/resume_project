/**
 * Draws an assistant chat reply written in Markdown: paragraphs, lists, bold, links, code,
 * tables and quotes. Raw HTML in the reply is left out, never run, and unsafe link
 * targets (like `javascript:`) are removed. Links open in a new tab. Images are never loaded:
 * the browser would fetch them automatically, which lets text planted in a job posting or
 * resume send the user's private details to another server in the image address. Only the
 * image's description is shown. Works on partial text too, so a streaming reply can be
 * drawn as it arrives.
 */
import type { ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
}

export function ChatMarkdown({ content, children }: { content: string; children?: ReactNode }) {
  return <div className="chat-text chat-markdown">
    <Markdown remarkPlugins={[remarkGfm]} components={components}>{content}</Markdown>
    {children}
  </div>
}

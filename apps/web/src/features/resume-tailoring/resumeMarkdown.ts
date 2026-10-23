/** Parse the resume's small Markdown subset into inert text and formatting runs.
 * Unsupported syntax remains visible text; links require a safe explicit scheme.
 */
export interface ResumeMarkdownRun { text: string; bold?: boolean; italic?: boolean; href?: string }
export interface ResumeMarkdownBlock { type: 'heading' | 'paragraph' | 'bullet'; level?: 1 | 2 | 3; children: ResumeMarkdownRun[] }

/**
 * Only ATX headings (levels 1–3), plain paragraphs, dash/star bullets, simple
 * non-nested *italic* / **bold** spans, and HTTP(S)/mailto links are formatting.
 * Blank lines separate paragraphs; other syntax, including HTML and layout
 * controls, is printed literally and cannot affect the document template.
 */
export function parseResumeMarkdown(source: string): ResumeMarkdownBlock[] {
  const blocks: ResumeMarkdownBlock[] = []
  const paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) })
    paragraph.length = 0
  }
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) { flush(); continue }
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(trimmed)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2]) })
      continue
    }
    const bullet = /^[-*]\s+(.+?)\s*$/.exec(trimmed)
    if (bullet) {
      flush()
      blocks.push({ type: 'bullet', children: parseInline(bullet[1]) })
      continue
    }
    paragraph.push(trimmed)
  }
  flush()
  return blocks
}

function parseInline(source: string): ResumeMarkdownRun[] {
  const runs: ResumeMarkdownRun[] = []
  const add = (run: ResumeMarkdownRun) => {
    if (!run.text) return
    const last = runs.at(-1)
    if (last && !last.bold && !last.italic && !last.href && !run.bold && !run.italic && !run.href) last.text += run.text
    else runs.push(run)
  }
  let position = 0
  while (position < source.length) {
    const rest = source.slice(position)
    const link = /^\[([^\]\n]+)\]\(([^\s()]+)\)/.exec(rest)
    if (link) {
      if (/^(https?:\/\/|mailto:)/i.test(link[2])) add({ text: link[1], href: link[2] })
      else add({ text: link[0] })
      position += link[0].length
      continue
    }
    const bold = /^(\*\*|__)([^\n]+?)\1/.exec(rest)
    if (bold) { add({ text: bold[2], bold: true }); position += bold[0].length; continue }
    const italic = /^(\*|_)([^\n]+?)\1/.exec(rest)
    if (italic) { add({ text: italic[2], italic: true }); position += italic[0].length; continue }
    add({ text: source[position] })
    position++
  }
  return runs
}

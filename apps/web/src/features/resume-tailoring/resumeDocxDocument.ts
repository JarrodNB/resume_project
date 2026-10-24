/** Build editable Word output from the same content used by the PDF preview.
 * Native paragraphs, headings, bullets and links flow across Letter pages.
 * This runs locally; Word may paginate differently or substitute Helvetica.
 */
import { BorderStyle, Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { parseResumeMarkdown, type ResumeMarkdownBlock } from './resumeMarkdown'

/** Produce editable Word content from the same Markdown blocks as PDF output. */
export function generateResumeDocx(markdown: string): Promise<Blob> {
  const blocks = parseResumeMarkdown(markdown)
  const children = blocks.map((block) => markdownParagraph(block))
  const title = blocks.find((block) => block.type === 'heading')?.children.map((run) => run.text).join('') || 'Resume'
  return Packer.toBlob(new Document({
    title,
    styles: {
      default: {
        document: { run: { font: 'Helvetica', size: 20, color: '1A1A1A' }, paragraph: { spacing: { line: 324, after: 80 } } },
        heading1: { run: { font: 'Helvetica', size: 36, bold: true }, paragraph: { keepNext: true, spacing: { after: 100 } } },
        heading2: { run: { font: 'Helvetica', size: 22, bold: true }, paragraph: { keepNext: true, spacing: { before: 260, after: 100 }, border: { bottom: { color: '1A1A1A', style: BorderStyle.SINGLE, size: 5, space: 2 } } } },
        heading3: { run: { font: 'Helvetica', size: 20, bold: true }, paragraph: { keepNext: true, spacing: { before: 140, after: 40 } } },
      },
    },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 800, bottom: 800, left: 960, right: 960 } } }, children }],
  }))
}

function markdownParagraph(block: ResumeMarkdownBlock): Paragraph {
  const children = block.children.map((run) => {
    const text = new TextRun({ text: run.text, bold: run.bold, italics: run.italic, ...(run.href ? { style: 'Hyperlink' } : {}) })
    return run.href ? new ExternalHyperlink({ link: run.href, children: [text] }) : text
  })
  return new Paragraph({
    children,
    ...(block.type === 'heading' ? { heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3 } : {}),
    ...(block.type === 'bullet' ? { bullet: { level: 0 } } : {}),
  })
}

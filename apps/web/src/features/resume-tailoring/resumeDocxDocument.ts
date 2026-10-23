/** Build editable Word output from the same content used by the PDF preview.
 * Native paragraphs, headings, bullets and links flow across Letter pages.
 * This runs locally; Word may paginate differently or substitute Helvetica.
 */
import { BorderStyle, Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TabStopType, TextRun } from 'docx'
import type { ResumePdfModel } from './resumePdfModel'
import { parseResumeMarkdown, type ResumeMarkdownBlock } from './resumeMarkdown'

/** Produce an editable document from a captured saved resume. No upload or storage. */
export function generateResumeDocx(model: ResumePdfModel | string): Promise<Blob> {
  if (typeof model === 'string') return generateMarkdownDocx(model)
  const children: Paragraph[] = []
  if (model.name) {
    children.push(new Paragraph({
      children: [new TextRun({ text: model.name, bold: true, size: 36 })],
      spacing: { after: 80 },
    }))
  }
  if (model.contactLine) {
    children.push(new Paragraph({
      children: [new TextRun({ text: model.contactLine, size: 18, color: '333333' })],
    }))
  }
  if (model.links.length) {
    children.push(new Paragraph({
      children: model.links.flatMap((link, index) => [
        ...(index ? [new TextRun(' · ')] : []),
        new ExternalHyperlink({
          link: link.url,
          children: [new TextRun({ text: link.label, style: 'Hyperlink', size: 18 })],
        }),
      ]),
    }))
  }
  for (const block of model.blocks) {
    children.push(new Paragraph({ text: block.title, heading: HeadingLevel.HEADING_1 }))
    if (block.text) children.push(...textParagraphs(block.text))
    for (const entry of block.entries) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({ text: entry.heading, bold: true }),
          ...(entry.dates ? [new TextRun({
            text: `\t${entry.dates}`, size: 18, bold: false, color: '333333',
          })] : []),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: 10320 }],
      }))
      if (entry.meta) {
        children.push(new Paragraph({
          children: [new TextRun({ text: entry.meta, italics: true, size: 18, color: '333333' })],
        }))
      }
      if (entry.body) children.push(...textParagraphs(entry.body))
      for (const bullet of entry.bullets) {
        children.push(new Paragraph({ text: bullet, bullet: { level: 0 }, spacing: { after: 20 } }))
      }
    }
  }
  return Packer.toBlob(new Document({
    title: model.name || 'Resume',
    styles: {
      default: {
        document: {
          run: { font: 'Helvetica', size: 20, color: '1A1A1A' },
          paragraph: { spacing: { line: 324, after: 40 } },
        },
        heading1: {
          run: { font: 'Helvetica', size: 22, bold: true, allCaps: true },
          paragraph: {
            keepNext: true,
            spacing: { before: 280, after: 120 },
            border: { bottom: { color: '1A1A1A', style: BorderStyle.SINGLE, size: 5, space: 2 } },
          },
        },
        heading2: {
          run: { font: 'Helvetica', size: 20, bold: true },
          paragraph: { keepNext: true, spacing: { before: 120, after: 0 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 800, bottom: 800, left: 960, right: 960 },
        },
      },
      children,
    }],
  }))
}

/** Native Word content from the exact blocks that the PDF renderer consumes. */
function generateMarkdownDocx(markdown: string): Promise<Blob> {
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

/** Preserve intentional line breaks in summaries and grouped skills as editable paragraphs. */
function textParagraphs(text: string): Paragraph[] {
  return text.split('\n').map((line) => new Paragraph({ text: line }))
}

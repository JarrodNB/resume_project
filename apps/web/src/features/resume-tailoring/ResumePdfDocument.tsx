/**
 * The resume PDF shared by live preview and saved downloads. Long sections and
 * entries flow across Letter pages while headings stay with following text.
 */
import { Document, Link, Page, StyleSheet, Text } from '@react-pdf/renderer'
import { parseResumeMarkdown, type ResumeMarkdownBlock } from './resumeMarkdown'

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 40, paddingHorizontal: 48, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.35, color: '#1a1a1a' },
  bullet: { marginLeft: 8, marginTop: 1 },
  markdownTitle: { fontFamily: 'Helvetica-Bold', fontSize: 18, marginBottom: 5 },
  markdownSection: { fontFamily: 'Helvetica-Bold', fontSize: 11, marginTop: 13, marginBottom: 5, paddingBottom: 2, borderBottomWidth: 0.6, borderBottomColor: '#1a1a1a' },
  markdownSubheading: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginTop: 7, marginBottom: 2 },
  markdownParagraph: { marginBottom: 5 },
})

/** Render the saved Markdown with the same fixed Letter template everywhere. */
export function ResumePdfDocument({ model }: { model: string }) {
  const blocks = parseResumeMarkdown(model)
  return <Document title={blocks.find((block) => block.type === 'heading')?.children.map((run) => run.text).join('') || 'Resume'}>
    <Page size="LETTER" style={styles.page}>
      {blocks.map((block, index) => <MarkdownPdfBlock key={index} block={block} />)}
    </Page>
  </Document>
}

/** The same fixed Letter page is used by preview, downloads, and the worker. */
function MarkdownPdfBlock({ block }: { block: ResumeMarkdownBlock }) {
  const style = block.type === 'bullet' ? styles.bullet : block.type === 'paragraph' ? styles.markdownParagraph : block.level === 1 ? styles.markdownTitle : block.level === 2 ? styles.markdownSection : styles.markdownSubheading
  return <Text style={style} minPresenceAhead={block.type === 'heading' ? 20 : undefined}>
    {block.type === 'bullet' ? '• ' : null}
    {block.children.map((run, index) => {
      const bold = run.bold || block.type === 'heading'
      const fontFamily = bold ? (run.italic ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : run.italic ? 'Helvetica-Oblique' : 'Helvetica'
      const content = <Text key={index} style={{ fontFamily }}>{run.text}</Text>
      return run.href ? <Link key={index} src={run.href}>{content}</Link> : content
    })}
  </Text>
}

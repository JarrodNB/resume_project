/**
 * The resume PDF shared by live preview and saved downloads. Long sections and
 * entries flow across Letter pages while headings stay with following text.
 */
import { Document, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ResumePdfBlock, ResumePdfEntry, ResumePdfModel } from './resumePdfModel'

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 40, paddingHorizontal: 48, fontFamily: 'Helvetica', fontSize: 10, lineHeight: 1.35, color: '#1a1a1a' },
  name: { fontFamily: 'Helvetica-Bold', fontSize: 18, marginBottom: 4 },
  contact: { fontSize: 9, color: '#333333', marginBottom: 2 },
  sectionTitle: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 2,
    borderBottomWidth: 0.6,
    borderBottomColor: '#1a1a1a',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  entry: { marginBottom: 8 },
  entryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  heading: { fontFamily: 'Helvetica-Bold', flexGrow: 1, paddingRight: 12 },
  dates: { fontSize: 9, color: '#333333' },
  meta: { fontSize: 9, fontFamily: 'Helvetica-Oblique', color: '#333333', marginBottom: 2 },
  body: { marginTop: 2 },
  bullet: { marginLeft: 8, marginTop: 1 },
})

/** Letter pages: name and contact, then each section that has text. */
export function ResumePdfDocument({ model, onPageCount }: { model: ResumePdfModel; onPageCount?: (count: number) => void }) {
  return (
    <Document title={model.name || 'Resume'}>
      <Page size="LETTER" style={styles.page}>
        {onPageCount && <Text fixed style={{ position: 'absolute', width: 0, height: 0 }} render={({ totalPages }) => {
          // The public renderer callback runs again once final pagination is known.
          if (totalPages) onPageCount(totalPages)
          return ''
        }} />}
        {model.name ? <Text style={styles.name}>{model.name}</Text> : null}
        {model.contactLine ? <Text style={styles.contact}>{model.contactLine}</Text> : null}
        {model.links.length > 0 ? (
          <Text style={styles.contact}>
            {model.links.map((link, index) => (
              <Text key={link.url}>{index > 0 ? ' · ' : ''}<Link src={link.url}>{link.label}</Link></Text>
            ))}
          </Text>
        ) : null}
        {model.blocks.map((block, index) => (
          <PdfBlock key={`${block.title}-${index}`} block={block} />
        ))}
      </Page>
    </Document>
  )
}

/** A section heading and either a paragraph or its entries. The heading stays with what follows it. */
function PdfBlock({ block }: { block: ResumePdfBlock }) {
  if (block.entries.length === 0) {
    return (
      <View>
        <Text style={styles.sectionTitle} minPresenceAhead={24}>{block.title}</Text>
        {block.text ? <Text>{block.text}</Text> : null}
      </View>
    )
  }

  return (
    <View>
      <Text style={styles.sectionTitle} minPresenceAhead={24}>{block.title}</Text>
      {block.entries.map((entry, index) => (
        <PdfEntry key={`${entry.heading}-${index}`} entry={entry} />
      ))}
    </View>
  )
}

/** One role, project, or school. */
function PdfEntry({ entry }: { entry: ResumePdfEntry }) {
  return (
    <View style={styles.entry}>
      <View style={styles.entryRow} wrap={false} minPresenceAhead={20}>
        <Text style={styles.heading}>{entry.heading}</Text>
        {entry.dates ? <Text style={styles.dates}>{entry.dates}</Text> : null}
      </View>
      {entry.meta ? <Text style={styles.meta}>{entry.meta}</Text> : null}
      {entry.body ? <Text style={styles.body}>{entry.body}</Text> : null}
      {entry.bullets.map((bullet, index) => (
        <Text key={index} style={styles.bullet}>{`• ${bullet}`}</Text>
      ))}
    </View>
  )
}

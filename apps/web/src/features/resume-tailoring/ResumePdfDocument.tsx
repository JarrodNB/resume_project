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
  entryEnd: { marginBottom: 8 },
  entryHeader: { flexShrink: 0 },
  entryRow: { flexShrink: 0, flexDirection: 'row', justifyContent: 'space-between' },
  heading: { fontFamily: 'Helvetica-Bold', flexGrow: 1, paddingRight: 12 },
  dates: { fontSize: 9, color: '#333333' },
  meta: { fontSize: 9, fontFamily: 'Helvetica-Oblique', color: '#333333', marginBottom: 2 },
  body: { marginTop: 2 },
  bullet: { marginLeft: 8, marginTop: 1 },
})

/** Letter pages: name and contact, then each section that has text. */
export function ResumePdfDocument({ model }: { model: ResumePdfModel }) {
  return (
    <Document title={model.name || 'Resume'}>
      <Page size="LETTER" style={styles.page}>
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
      <>
        <Text style={styles.sectionTitle} minPresenceAhead={24}>{block.title}</Text>
        {block.text ? <Text>{block.text}</Text> : null}
      </>
    )
  }

  return (
    <>
      {block.entries.map((entry, index) => (
        <PdfEntry key={`${entry.heading}-${index}`} entry={entry} sectionTitle={index === 0 ? block.title : undefined} />
      ))}
    </>
  )
}

/** Keep the section title and entry header together even when a long title wraps.
 * Only the header is unbreakable; details enter page flow directly so nested
 * container splitting cannot separate a title or move a whole entry body.
 */
function PdfEntry({ entry, sectionTitle }: { entry: ResumePdfEntry; sectionTitle?: string }) {
  const hasDetails = Boolean(entry.body || entry.bullets.length)
  return (
    <>
      <View
        style={hasDetails ? styles.entryHeader : [styles.entryHeader, styles.entryEnd]}
        wrap={false}
        minPresenceAhead={hasDetails ? 20 : 0}
      >
        {sectionTitle ? <Text style={styles.sectionTitle}>{sectionTitle}</Text> : null}
        <View style={styles.entryRow} wrap={false}>
          <Text style={styles.heading}>{entry.heading}</Text>
          {entry.dates ? <Text style={styles.dates}>{entry.dates}</Text> : null}
        </View>
        {entry.meta ? <Text style={styles.meta}>{entry.meta}</Text> : null}
      </View>
      {entry.body ? (
        <Text style={entry.bullets.length ? styles.body : [styles.body, styles.entryEnd]}>{entry.body}</Text>
      ) : null}
      {entry.bullets.map((bullet, index) => (
        <Text key={index} style={index === entry.bullets.length - 1 ? [styles.bullet, styles.entryEnd] : styles.bullet}>
          {`• ${bullet}`}
        </Text>
      ))}
    </>
  )
}

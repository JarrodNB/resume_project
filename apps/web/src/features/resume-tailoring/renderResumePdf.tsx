/** Render the same fixed resume PDF used by preview/downloads from a worker process.
 * Reads bounded UTF-8 Markdown on stdin and emits only PDF bytes on stdout.
 */
import { readFileSync } from 'node:fs'
import { pdf } from '@react-pdf/renderer'
import { ResumePdfDocument } from './ResumePdfDocument'

const markdown = readFileSync(0, 'utf8')
if (markdown.length > 100_000) throw new Error('Resume Markdown is too long')
const blob = await pdf(<ResumePdfDocument model={markdown} />).toBlob()
if (blob.size > 10_000_000) throw new Error('Rendered resume PDF is too large')
process.stdout.write(Buffer.from(await blob.arrayBuffer()))

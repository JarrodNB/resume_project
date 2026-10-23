/** Refresh synthetic Rails integration fixtures using the real browser DOCX exporter.
 * Run inside the web container from /app; no browser or user data is involved.
 */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { generateResumeDocx } = await import(pathToFileURL(resolve('src/features/resume-tailoring/resumeDocxDocument.ts')).href)
const output = process.argv[2] || '/fixtures'
for (const [name, count] of [['short', 3], ['overflow', 120]]) {
  const model = {
    name: 'Ada Example', contactLine: 'ada@example.test',
    links: [{ label: 'Portfolio', url: 'https://example.test/ada' }],
    blocks: [{ title: 'Experience', text: '', entries: [{
      heading: 'Software Engineer at Example Company', meta: 'Remote', dates: '2020 – Present',
      body: 'Built reliable tools for colleagues.',
      bullets: Array.from({ length: count }, (_, i) => `Achievement ${i + 1}: delivered reliable software and helped teammates improve their daily work.`),
    }] }],
  }
  const blob = await generateResumeDocx(model)
  await writeFile(resolve(output, `${name}.docx`), Buffer.from(await blob.arrayBuffer()))
}

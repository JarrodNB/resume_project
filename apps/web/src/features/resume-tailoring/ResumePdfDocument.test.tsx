// @vitest-environment node
/** Render a real multi-page grouped PDF without a browser or preview mock. */
import { renderToBuffer } from '@react-pdf/renderer'
import { expect, it, vi } from 'vitest'

// The shared DOM-test cleanup also runs in this Node-only renderer test.
vi.stubGlobal('localStorage', { clear: vi.fn() })
import { ResumePdfDocument } from './ResumePdfDocument'
import { buildResumePdfModel } from './resumePdfModel'

it('renders grouped roles and a long shared list across pages', async () => {
  const model = buildResumePdfModel([{ sectionType: 'experience', title: 'Experience', content: { items: [{
    company: 'Synthetic Company', roles: [
      { title: 'Senior Engineer', start_date: '2025-01', end_date: null, is_current: true, highlights: ['Led migrations'] },
      { title: 'Engineer', start_date: '2020-01', end_date: '2024-12', highlights: [] },
    ], highlights: Array.from({ length: 70 }, (_, index) => `Shared achievement ${index + 1}: Built reliable services for the platform.`),
  }] } }])
  const buffer = await renderToBuffer(<ResumePdfDocument model={model} />)
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  expect(buffer.length).toBeGreaterThan(3000)
  // The grouped block must be allowed to span pages rather than overflow one page.
  const pages = buffer.toString('latin1').match(/\/Type \/Page\b/g)
  expect(pages?.length).toBeGreaterThan(1)
})

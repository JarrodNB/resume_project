/**
 * Description: Synthetic ParsedResume used by tests (no real personal data).
 * Index:
 *   - buildParsedResume: a complete parse with one of each entry type and a warning
 */
import type { ParsedResume } from '@/features/resume-import/parsedResume'

/** Returns a fresh synthetic ParsedResume. */
export function buildParsedResume(): ParsedResume {
  return {
    contact: { full_name: 'Ada Example', email: 'ada@example.com', phone: null, location: 'Perth', links: [] },
    summary: 'Backend engineer.',
    experiences: [
      {
        company: 'Acme',
        title: 'Engineer',
        location: null,
        start_date: '2021-03',
        end_date: null,
        is_current: true,
        description: null,
        highlights: ['Built the billing service', 'Cut deploy time in half'],
      },
    ],
    projects: [],
    educations: [
      {
        institution: 'State University',
        degree: 'B.S.',
        field_of_study: 'Computer Science',
        start_date: '2015',
        end_date: '2019',
        description: null,
      },
    ],
    skills: [{ name: 'Ruby', category: 'Languages' }],
    parsing_warnings: ['Unclear whether "Freelance" is a job or a project.'],
  }
}

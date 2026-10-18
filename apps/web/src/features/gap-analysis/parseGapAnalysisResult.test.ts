/**
 * Description: parseGapAnalysisResult reads result.gap_analysis and drops malformed entries.
 */
import { expect, it } from 'vitest'
import { parseGapAnalysisResult } from './parseGapAnalysisResult'

it('returns null when there is no gap analysis', () => {
  expect(parseGapAnalysisResult(null)).toBeNull()
  expect(parseGapAnalysisResult({ scraped_job: {} })).toBeNull()
  expect(parseGapAnalysisResult({ gap_analysis: { summary: 'x' } })).toBeNull()
})

it('keeps valid assessments and drops malformed ones', () => {
  const parsed = parseGapAnalysisResult({
    gap_analysis: {
      summary: 'Good match.',
      assessments: [
        {
          kind: 'nice_to_have',
          requirement: 'Kubernetes',
          verdict: 'partial',
          explanation: 'Close.',
          evidence: [{ kind: 'project', id: 'project-1', text: 'Deploy bot', context: null }, { id: 'no-text' }],
        },
        { requirement: 'Go', verdict: 'unknown' },
        { verdict: 'met' },
      ],
    },
    warnings: ['One of your notes was left out.'],
  })

  expect(parsed).toEqual({
    summary: 'Good match.',
    assessments: [
      {
        kind: 'nice_to_have',
        requirement: 'Kubernetes',
        verdict: 'partial',
        explanation: 'Close.',
        evidence: [{ kind: 'project', id: 'project-1', text: 'Deploy bot', context: null }],
      },
    ],
    warnings: ['One of your notes was left out.'],
  })
})


it('drops assessment kinds outside the qualification contract', () => {
  const parsed = parseGapAnalysisResult({ gap_analysis: { assessments: [
    { kind: 'required', requirement: 'Python', verdict: 'met' },
    { kind: 'responsibility', requirement: 'Ship models', verdict: 'met' },
    { kind: 'other', requirement: 'Unknown', verdict: 'missing' },
  ] } })

  expect(parsed?.assessments.map((item) => item.requirement)).toEqual(['Python'])
})

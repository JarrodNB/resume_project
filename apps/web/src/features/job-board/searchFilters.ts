/** Choices and readable summaries shared by the form and submitted results. */
import type { JobBoardExperienceLevel, JobBoardFiltersInput } from '@/graphql/generated/graphql'
export const experienceLevelOptions: { value: JobBoardExperienceLevel; label: string }[] = [
  { value: 'EN', label: 'Entry level' }, { value: 'MI', label: 'Mid level' },
  { value: 'SE', label: 'Senior' }, { value: 'EX', label: 'Executive' },
]
export const employmentTypeOptions = [
  ['FULL_TIME', 'Full-time'], ['PART_TIME', 'Part-time'], ['CONTRACT', 'Contract'], ['INTERN', 'Internship'],
  ['TEMPORARY', 'Temporary'], ['FREELANCE', 'Freelance'], ['APPRENTICESHIP', 'Apprenticeship'],
  ['VOLUNTEER', 'Volunteer'], ['PER_DIEM', 'Per diem'], ['OTHER', 'Other'],
] as const
export const remoteOptions = [
  ['', 'Any arrangement'], ['remote', 'Any remote option'], ['fully_remote', 'Fully remote'],
  ['hybrid', 'Hybrid'], ['remote_country', 'Remote — country restricted'], ['remote_region', 'Remote — region restricted'],
] as const
export const ageOptions = [['', 'Any time'], ['24h', 'Past 24 hours'], ['7d', 'Past 7 days'], ['30d', 'Past 30 days']] as const
export type BoardSearch = {
  keyword: string; remoteOnly: boolean; experienceLevels: JobBoardExperienceLevel[]
  filters?: JobBoardFiltersInput; locationLabel?: string
}
export function describeSearch(search: BoardSearch) {
  const filters = search.filters ?? {}
  return [
    `For “${search.keyword}”`, search.locationLabel,
    remoteOptions.find(([value]) => value === filters.remoteType)?.[1] ?? (search.remoteOnly ? 'Any remote option' : null),
    ageOptions.find(([value]) => value === filters.maxAge)?.[1],
    search.experienceLevels.length ? experienceLevelOptions.filter(({ value }) => search.experienceLevels.includes(value)).map(({ label }) => label).join(', ') : 'All experience levels',
    employmentTypeOptions.filter(([value]) => filters.employmentTypes?.includes(value)).map(([, label]) => label).join(', '),
    filters.companyName && `Company: ${filters.companyName}`,
    filters.minimumSalary && `Minimum pay: ${filters.minimumSalary.toLocaleString()}${filters.includeUndisclosedSalaries ? ' (undisclosed included)' : ' (disclosed only)'}`,
    filters.sortBy === 'relevance' ? 'Most relevant' : 'Newest',
  ].filter(Boolean).join(' · ')
}

/** Roles shown per numbered results page; matches the size the job provider returns per request. */
export const boardPageSize = 20

/** Page numbers to show: first, last, and neighbors of the current page, with null for a gap. */
export function pagerItems(current: number, total: number): Array<number | null> {
  const wanted = [...new Set([0, total - 1, current - 1, current, current + 1].filter((page) => page >= 0 && page < total))].sort((a, b) => a - b)
  return wanted.flatMap((page, index) => index > 0 && page - wanted[index - 1] > 1 ? [null, page] : [page])
}

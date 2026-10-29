/** Translate untrusted URL values into bounded provider filters.
 * Only resolved numeric location identities reach requests; labels are presentation text.
 */
import type { JobBoardFiltersInput } from '@/graphql/generated/graphql'
import { ageOptions, employmentTypeOptions, experienceLevelOptions, remoteOptions, type BoardSearch } from './searchFilters'

export function parseSearchUrl(url: string): BoardSearch | null {
  if (url.length > 8000) return null
  const params = new URLSearchParams(url)
  function text(key: string, max = 200) {
    const value = params.get(key)?.trim()
    // Reject control characters before provider requests or presentation.
    // eslint-disable-next-line no-control-regex
    return value && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined
  }
  function positiveInteger(key: string, max: number) {
    const value = params.get(key)
    if (!value || !/^\d+$/.test(value)) return undefined
    const number = Number(value)
    return Number.isSafeInteger(number) && number > 0 && number <= max ? number : undefined
  }
  const keyword = text('q')
  if (!keyword) return null
  const experienceLevels = [...new Set(params.getAll('level'))].filter((value): value is BoardSearch['experienceLevels'][number] => experienceLevelOptions.some((option) => option.value === value))
  const employmentTypes = [...new Set(params.getAll('employment'))].filter((value) => employmentTypeOptions.some(([option]) => option === value))
  const remote = remoteOptions.find(([value]) => value && value === params.get('remote'))?.[0]
  const maxAge = ageOptions.find(([value]) => value && value === params.get('age'))?.[0]
  const cityId = positiveInteger('city', 2147483647)
  const stateId = cityId ? undefined : positiveInteger('state', 2147483647)
  const companyName = text('company')
  const minimumSalary = positiveInteger('salary', 1_000_000_000)
  const locationLabel = cityId || stateId ? text('place', 100) : undefined
  const filters: JobBoardFiltersInput = {
    ...(remote && remote !== 'remote' && { remoteType: remote }), ...(maxAge && { maxAge }),
    ...(cityId && { cityId }), ...(stateId && { stateId }), ...(companyName && { companyName }),
    ...(employmentTypes.length && { employmentTypes }),
    ...(minimumSalary && { minimumSalary, includeUndisclosedSalaries: params.get('undisclosed') !== '0' }),
    ...(params.get('sort') === 'relevance' && { sortBy: 'relevance' }),
  }
  return { keyword, remoteOnly: Boolean(remote), experienceLevels, ...(Object.keys(filters).length && { filters }), ...(locationLabel && { locationLabel }) }
}

export function serializeSearchUrl(search: BoardSearch): string {
  const params = new URLSearchParams({ q: search.keyword.trim() })
  const filters = search.filters ?? {}
  for (const level of search.experienceLevels) params.append('level', level)
  for (const employment of filters.employmentTypes ?? []) params.append('employment', employment)
  if (filters.remoteType || search.remoteOnly) params.set('remote', filters.remoteType || 'remote')
  if (filters.maxAge) params.set('age', filters.maxAge)
  if (filters.cityId) params.set('city', String(filters.cityId))
  else if (filters.stateId) params.set('state', String(filters.stateId))
  if ((filters.cityId || filters.stateId) && search.locationLabel) params.set('place', search.locationLabel)
  if (filters.companyName) params.set('company', filters.companyName)
  if (filters.minimumSalary) {
    params.set('salary', String(filters.minimumSalary))
    if (filters.includeUndisclosedSalaries === false) params.set('undisclosed', '0')
  }
  if (filters.sortBy === 'relevance') params.set('sort', 'relevance')
  return '?' + params.toString()
}

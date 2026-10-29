/** Show the filters responsible for these results, independent of unfinished form edits.
 * Removing a chip submits a new search based only on the applied snapshot.
 */
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ageOptions, employmentTypeOptions, experienceLevelOptions, remoteOptions, type BoardSearch } from './searchFilters'

type Chip = { id: string; label: string; remove: () => BoardSearch }

export function JobBoardAppliedFilters({ search, onSearch }: { search: BoardSearch; onSearch: (search: BoardSearch) => void }) {
  const filters = search.filters ?? {}
  const chips: Chip[] = []
  function without(...keys: (keyof typeof filters)[]): BoardSearch {
    const remaining = { ...filters }
    keys.forEach((key) => { delete remaining[key] })
    return { ...search, filters: remaining }
  }
  if (search.remoteOnly || filters.remoteType) chips.push({
    id: 'remote', label: remoteOptions.find(([value]) => value === filters.remoteType)?.[1] ?? 'Any remote option',
    remove: () => ({ ...without('remoteType'), remoteOnly: false }),
  })
  if (filters.maxAge) chips.push({ id: 'age', label: ageOptions.find(([value]) => value === filters.maxAge)?.[1] ?? filters.maxAge, remove: () => without('maxAge') })
  if (filters.cityId || filters.stateId) chips.push({
    id: 'location', label: search.locationLabel ?? `Selected ${filters.cityId ? 'city' : 'state'} (${filters.cityId ?? filters.stateId})`,
    remove: () => ({ ...without('cityId', 'stateId'), locationLabel: undefined }),
  })
  for (const { value, label } of experienceLevelOptions) {
    if (search.experienceLevels.includes(value)) chips.push({ id: `level-${value}`, label, remove: () => ({ ...search, experienceLevels: search.experienceLevels.filter((level) => level !== value) }) })
  }
  for (const [value, label] of employmentTypeOptions) {
    if (filters.employmentTypes?.includes(value)) chips.push({ id: `employment-${value}`, label, remove: () => ({ ...search, filters: { ...filters, employmentTypes: filters.employmentTypes?.filter((type) => type !== value) } }) })
  }
  if (filters.companyName) chips.push({ id: 'company', label: `Company: ${filters.companyName}`, remove: () => without('companyName') })
  // Disclosure only changes provider matching when a salary minimum is present.
  if (filters.minimumSalary) chips.push({ id: 'salary', label: `Minimum pay: ${filters.minimumSalary.toLocaleString()} (${filters.includeUndisclosedSalaries === false ? 'disclosed only' : 'undisclosed included'})`, remove: () => without('minimumSalary', 'includeUndisclosedSalaries') })
  if (filters.sortBy === 'relevance') chips.push({ id: 'sort', label: 'Most relevant', remove: () => without('sortBy') })
  if (!chips.length) return null
  return <div className="board-applied-filters" role="group" aria-label="Applied filters">
    {chips.map(({ id, label, remove }) => <Button key={id} type="button" variant="outline" className="board-filter-chip" aria-label={`Remove ${label} filter`} onClick={() => onSearch(remove())}>{label}<X size={14} aria-hidden="true" /></Button>)}
    <Button type="button" variant="ghost" className="board-clear-filters" onClick={() => onSearch({ keyword: search.keyword, remoteOnly: false, experienceLevels: [] })}>Clear filters</Button>
  </div>
}

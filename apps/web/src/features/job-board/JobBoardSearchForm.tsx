/** Keep editable preferences separate from submitted searches. The keyword and search button sit
 * above a remembered, collapsible Filters panel holding every filter: date, remote, sort,
 * experience level and employment type (dropdown multi-selects), location, and more filters.
 * The panel stays mounted so choices survive closing it, and location names must resolve
 * before a search is sent. Children (reranking) follow the panel. Router entries remount the
 * form with a submitted initial search; later edits stay local until the user submits.
 */
import { useState, type ReactNode } from 'react'
import { Globe2, Search, SlidersHorizontal } from 'lucide-react'
import type { JobBoardExperienceLevel, JobBoardFiltersInput } from '@/graphql/generated/graphql'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CollapseToggle } from '@/components/CollapseToggle'
import { useOpenSection } from '@/components/useOpenSection'
import { JobBoardMultiSelect } from './JobBoardMultiSelect'
import { JobBoardLocationPicker, type LocationChoice } from './JobBoardLocationPicker'
import { ageOptions, employmentTypeOptions, experienceLevelOptions, remoteOptions, type BoardSearch } from './searchFilters'

const employmentTypeChoices = employmentTypeOptions.map(([value, label]) => ({ value, label }))

export function JobBoardSearchForm({ onSearch, keyword, onKeywordChange, children, initialSearch }: { initialSearch?: BoardSearch | null; children?: ReactNode; onSearch: (search: BoardSearch) => void; keyword: string; onKeywordChange: (value: string) => void }) {
  const [remote, setRemote] = useState(initialSearch?.filters?.remoteType ?? (initialSearch?.remoteOnly ? 'remote' : ''))
  const [maxAge, setMaxAge] = useState(initialSearch?.filters?.maxAge ?? '')
  const [sortBy, setSortBy] = useState(initialSearch?.filters?.sortBy ?? 'published')
  const [experienceLevels, setExperienceLevels] = useState<JobBoardExperienceLevel[]>(initialSearch?.experienceLevels ?? [])
  const [employmentTypes, setEmploymentTypes] = useState<string[]>(initialSearch?.filters?.employmentTypes ?? [])
  const [location, setLocation] = useState<LocationChoice | null>(() => {
    const filters = initialSearch?.filters
    const id = filters?.cityId ?? filters?.stateId
    if (!id) return null
    const kind = filters?.cityId ? 'city' : 'state'
    return { kind, providerId: id, label: initialSearch?.locationLabel ?? `Selected ${kind} (${id})` }
  })
  const [unresolvedLocation, setUnresolvedLocation] = useState(false)
  const [companyName, setCompanyName] = useState(initialSearch?.filters?.companyName ?? '')
  const [minimumSalary, setMinimumSalary] = useState(initialSearch?.filters?.minimumSalary?.toString() ?? '')
  const [includeUndisclosed, setIncludeUndisclosed] = useState(initialSearch?.filters?.includeUndisclosedSalaries !== false)
  const filters = useOpenSection('job-board:filters')
  const advanced = useOpenSection('job-board:more-filters')
  const salaryValid = !minimumSalary || (Number.isInteger(Number(minimumSalary)) && Number(minimumSalary) >= 1 && Number(minimumSalary) <= 1_000_000_000)
  const advancedCount = Number(Boolean(companyName.trim())) + Number(Boolean(minimumSalary))
  const activeFilterCount = advancedCount + Number(Boolean(maxAge)) + Number(Boolean(remote)) + Number(Boolean(location)) + Number(sortBy !== 'published') + Number(experienceLevels.length > 0) + Number(employmentTypes.length > 0)
  return <form aria-label="Find jobs" className="board-search" onSubmit={(event) => {
    event.preventDefault()
    if (!keyword.trim() || unresolvedLocation || !salaryValid) return
    const filters: JobBoardFiltersInput = {
      ...(maxAge && { maxAge }), ...(employmentTypes.length > 0 && { employmentTypes: [...employmentTypes] }),
      ...(remote && remote !== 'remote' && { remoteType: remote }),
      ...(location && (location.kind === 'city' ? { cityId: location.providerId } : { stateId: location.providerId })),
      ...(companyName.trim() && { companyName: companyName.trim() }),
      ...(minimumSalary && { minimumSalary: Number(minimumSalary), includeUndisclosedSalaries: includeUndisclosed }),
      ...(sortBy === 'relevance' && { sortBy }),
    }
    onSearch({ keyword: keyword.trim(), remoteOnly: Boolean(remote), experienceLevels: [...experienceLevels], ...(Object.keys(filters).length > 0 && { filters }), locationLabel: location?.label })
  }}>
    <Label htmlFor="job-board-keyword">Keyword or job title</Label>
    <div className="board-search-field"><div className="board-keyword"><Search size={19} strokeWidth={1.7} aria-hidden />
      <Input id="job-board-keyword" value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="e.g. Software engineer" maxLength={200} autoComplete="off" />
    </div><Button type="submit" disabled={!keyword.trim() || unresolvedLocation || !salaryValid} className="board-search-submit"><Search aria-hidden />Search jobs</Button></div>
    <div className="board-search-options"><span className="board-region"><Globe2 size={15} aria-hidden />US-based opportunities</span>
      <CollapseToggle open={filters.open} panelId={filters.panelId} onToggle={filters.toggle} className="board-filters-toggle"><SlidersHorizontal size={15} aria-hidden />Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}</CollapseToggle>
    </div>
    <div id={filters.panelId} hidden={!filters.open} className="board-filters-panel">
    <div className="board-filter-grid">
      <div><Label htmlFor="board-age">Date posted</Label><select id="board-age" value={maxAge} onChange={(event) => setMaxAge(event.target.value)}>{ageOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <div><Label htmlFor="board-remote">Remote arrangement</Label><select id="board-remote" value={remote} onChange={(event) => setRemote(event.target.value)}>{remoteOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <JobBoardLocationPicker initialChoice={location} onChange={(choice, unresolved) => { setLocation(choice); setUnresolvedLocation(unresolved) }} />
      <div><Label htmlFor="board-sort">Sort by</Label><select id="board-sort" value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="published">Newest</option><option value="relevance">Most relevant</option></select></div>
      <JobBoardMultiSelect id="board-experience" label="Experience level" emptyLabel="All levels" options={experienceLevelOptions} selected={experienceLevels} onChange={setExperienceLevels} />
      <JobBoardMultiSelect id="board-employment" label="Employment type" emptyLabel="All types" options={employmentTypeChoices} selected={employmentTypes} onChange={setEmploymentTypes} />
    </div>
    <div className="board-advanced"><CollapseToggle open={advanced.open} panelId={advanced.panelId} onToggle={advanced.toggle}>More filters{advancedCount > 0 && ` (${advancedCount})`}</CollapseToggle>
      {advanced.open && <div id={advanced.panelId} className="board-filter-grid">
        <div><Label htmlFor="board-company">Company</Label><Input id="board-company" value={companyName} maxLength={200} placeholder="Any company" onChange={(event) => setCompanyName(event.target.value)} /></div>
        <div><Label htmlFor="board-salary">Minimum salary</Label><Input id="board-salary" type="number" min="1" max="1000000000" step="1" value={minimumSalary} onChange={(event) => setMinimumSalary(event.target.value)} aria-describedby="board-salary-help" placeholder="No minimum" />
          <p id="board-salary-help" className="board-filter-help">Check each listing’s currency and pay period.</p>
          <Label className="board-undisclosed"><Checkbox checked={includeUndisclosed} disabled={!minimumSalary} onCheckedChange={(checked) => setIncludeUndisclosed(checked === true)} />Include undisclosed salaries</Label>
        </div>
      </div>}
    </div>
    </div>
    {unresolvedLocation && !filters.open && <p role="alert" className="board-filter-help">Choose a location from the list in Filters, or clear it, to search.</p>}
    {!salaryValid && <p role="alert" className="board-filter-help">Enter a whole-number minimum salary between 1 and 1,000,000,000, or clear the minimum in More filters.</p>}
    {children}
  </form>
}

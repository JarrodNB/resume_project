/** Keep editable preferences separate from submitted searches. Advanced filters stay
 * in a remembered disclosure; location names must resolve before a search is sent.
 */
import { useState, type ReactNode } from 'react'
import { Globe2, Search } from 'lucide-react'
import type { JobBoardExperienceLevel, JobBoardFiltersInput } from '@/graphql/generated/graphql'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CollapseToggle } from '@/components/CollapseToggle'
import { useOpenSection } from '@/components/useOpenSection'
import { JobBoardLocationPicker, type LocationChoice } from './JobBoardLocationPicker'
import { ageOptions, employmentTypeOptions, experienceLevelOptions, remoteOptions, type BoardSearch } from './searchFilters'

export function JobBoardSearchForm({ onSearch, keyword, onKeywordChange, children }: { children?: ReactNode; onSearch: (search: BoardSearch) => void; keyword: string; onKeywordChange: (value: string) => void }) {
  const [remote, setRemote] = useState('')
  const [maxAge, setMaxAge] = useState('')
  const [sortBy, setSortBy] = useState('published')
  const [experienceLevels, setExperienceLevels] = useState<JobBoardExperienceLevel[]>([])
  const [employmentTypes, setEmploymentTypes] = useState<string[]>([])
  const [location, setLocation] = useState<LocationChoice | null>(null)
  const [unresolvedLocation, setUnresolvedLocation] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [minimumSalary, setMinimumSalary] = useState('')
  const [includeUndisclosed, setIncludeUndisclosed] = useState(true)
  const advanced = useOpenSection('job-board:more-filters')
  const salaryValid = !minimumSalary || (Number.isInteger(Number(minimumSalary)) && Number(minimumSalary) >= 1 && Number(minimumSalary) <= 1_000_000_000)
  const advancedCount = Number(Boolean(companyName.trim())) + Number(Boolean(minimumSalary))
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
    <div className="board-search-options"><span className="board-region"><Globe2 size={15} aria-hidden />US-based opportunities</span></div>
    <div className="board-filter-grid">
      <div><Label htmlFor="board-age">Date posted</Label><select id="board-age" value={maxAge} onChange={(event) => setMaxAge(event.target.value)}>{ageOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <div><Label htmlFor="board-remote">Remote arrangement</Label><select id="board-remote" value={remote} onChange={(event) => setRemote(event.target.value)}>{remoteOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      <JobBoardLocationPicker onChange={(choice, unresolved) => { setLocation(choice); setUnresolvedLocation(unresolved) }} />
      <div><Label htmlFor="board-sort">Sort by</Label><select id="board-sort" value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="published">Newest</option><option value="relevance">Most relevant</option></select></div>
    </div>
    <fieldset className="board-experience-levels" aria-describedby="experience-level-help"><legend>Experience level</legend><p id="experience-level-help">Select any levels, or leave blank to include all.</p>
      <div className="board-level-options">{experienceLevelOptions.map(({ value, label }) => <Label key={value} className="board-remote" data-checked={experienceLevels.includes(value)}>
        <Checkbox checked={experienceLevels.includes(value)} onCheckedChange={(checked) => setExperienceLevels((current) => experienceLevelOptions.filter((option) => option.value === value ? checked === true : current.includes(option.value)).map((option) => option.value))} />{label}
      </Label>)}</div>
    </fieldset>
    <fieldset className="board-experience-levels" aria-describedby="employment-type-help"><legend>Employment type</legend><p id="employment-type-help">Select any types, or leave blank to include all.</p>
      <div className="board-level-options">{employmentTypeOptions.map(([value, label]) => <Label key={value} className="board-remote" data-checked={employmentTypes.includes(value)}>
        <Checkbox checked={employmentTypes.includes(value)} onCheckedChange={(checked) => setEmploymentTypes((current) => employmentTypeOptions.filter(([type]) => type === value ? checked === true : current.includes(type)).map(([type]) => type))} />{label}
      </Label>)}</div>
    </fieldset>
    <div className="board-advanced"><CollapseToggle open={advanced.open} panelId={advanced.panelId} onToggle={advanced.toggle}>More filters{advancedCount > 0 && ` (${advancedCount})`}</CollapseToggle>
      {advanced.open && <div id={advanced.panelId} className="board-filter-grid">
        <div><Label htmlFor="board-company">Company</Label><Input id="board-company" value={companyName} maxLength={200} placeholder="Any company" onChange={(event) => setCompanyName(event.target.value)} /></div>
        <div><Label htmlFor="board-salary">Minimum salary</Label><Input id="board-salary" type="number" min="1" max="1000000000" step="1" value={minimumSalary} onChange={(event) => setMinimumSalary(event.target.value)} aria-describedby="board-salary-help" placeholder="No minimum" />
          <p id="board-salary-help" className="board-filter-help">Check each listing’s currency and pay period.</p>
          <Label className="board-undisclosed"><Checkbox checked={includeUndisclosed} disabled={!minimumSalary} onCheckedChange={(checked) => setIncludeUndisclosed(checked === true)} />Include undisclosed salaries</Label>
        </div>
      </div>}
    </div>
    {!salaryValid && <p role="alert" className="board-filter-help">Enter a whole-number minimum salary between 1 and 1,000,000,000, or clear the minimum in More filters.</p>}
    {children}
  </form>
}

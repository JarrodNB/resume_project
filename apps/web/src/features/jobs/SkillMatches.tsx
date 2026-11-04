/** Shows only the saved skills literally mentioned in a job, separately from the AI requirement comparison. */
import { Link } from 'react-router'
import { skillMentionCount } from './skillMentionCounts'
import { useSkillMatches } from './useSkillMatches'

export function SkillMatches({ description }: { description: string | null | undefined }) {
  const { data, loading, error } = useSkillMatches(Boolean(description?.trim()))
  const mentioned = (data?.skills ?? [])
    .map(skill => ({ skill, count: skillMentionCount(description ?? '', skill.name) }))
    .filter(({ count }) => count > 0)
  return (
    <section className="grid gap-2 border-t pt-3.5 text-sm">
      <h2 className="font-bold">Your skills this posting mentions</h2>
      {!description?.trim() ? <p className="text-muted-foreground">Add a job description to see skill matches.</p>
        : error ? <p role="alert">Couldn't load your skills. Reopen Fit to try again.</p>
        : loading || !data ? <p role="status" className="text-muted-foreground">Loading your skills…</p>
        : data.skills.length === 0 ? <p className="text-muted-foreground"><Link className="text-foreground underline" to="/library">Add skills to your career library</Link> to see their mentions here.</p>
        : mentioned.length === 0 ? <p className="text-muted-foreground">None of your saved skills are mentioned in this job description.</p>
        : (
          <ul aria-label="Saved skill mentions" className="flex flex-wrap gap-2">
            {mentioned.map(({ skill, count }) => (
              <li key={skill.id} className="inline-flex max-w-full items-baseline gap-1.5 rounded-[3px] border px-2 py-0.5 text-xs font-semibold">
                <span className="min-w-0 break-words">{skill.name}</span>
                <span className="font-normal whitespace-nowrap text-muted-foreground">{`${count} ${count === 1 ? 'mention' : 'mentions'}`}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

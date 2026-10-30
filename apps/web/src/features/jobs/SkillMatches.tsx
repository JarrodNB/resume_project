/** Shows literal mentions of saved skills separately from the AI requirement comparison. */
import { Link } from 'react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { skillMentionCount } from './skillMentionCounts'
import { useSkillMatches } from './useSkillMatches'

export function SkillMatches({ description }: { description: string | null | undefined }) {
  const { data, loading, error } = useSkillMatches(Boolean(description?.trim()))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Skill matches</CardTitle>
        <CardDescription>Exact mentions of your saved skills in this job description, ignoring capitalization.</CardDescription>
      </CardHeader>
      <CardContent>
        {!description?.trim() ? <p>Add a job description to see skill matches.</p>
          : error ? <p role="alert">Couldn't load your skills. Reopen Fit to try again.</p>
          : loading || !data ? <p role="status">Loading your skills…</p>
          : data.skills.length === 0 ? <p><Link className="underline" to="/library">Add skills to your career library</Link> to see their mentions here.</p>
          : (
            <ul aria-label="Saved skill mentions" className="grid gap-2 text-sm">
              {data.skills.map(skill => {
                const count = skillMentionCount(description, skill.name)
                return (
                  <li key={skill.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="min-w-0 break-words">{skill.name}</span>
                    <span className="text-muted-foreground">{count === 0 ? 'Not mentioned' : `${count} ${count === 1 ? 'mention' : 'mentions'}`}</span>
                  </li>
                )
              })}
            </ul>
          )}
      </CardContent>
    </Card>
  )
}

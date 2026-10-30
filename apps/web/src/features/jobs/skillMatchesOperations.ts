/** Reads only the signed-in user's saved skills for literal job-description counts. */
import { graphql } from '@/graphql/generated'

export const SKILL_MATCHES_QUERY = graphql(`
  query SkillMatches {
    skills {
      id
      name
      position
    }
  }
`)

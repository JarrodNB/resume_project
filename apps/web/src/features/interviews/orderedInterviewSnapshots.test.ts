/** Exercise transport ordering before normalized records can overwrite saved progress. */
import { ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client'
import { expect, it } from 'vitest'
import { orderedInterviewSnapshots } from './orderedInterviewSnapshots'
import { INTERVIEW_FIELDS } from './interviewOperations'

it.each(['interviewSession', 'interviewSessionUpdated', 'submitInterviewTurn'])('preserves newer progress for %s responses', async key => {
  const cache = new InMemoryCache()
  const current = { __typename: 'InterviewSession', id: 'session', revision: 2, status: 'active', interviewType: 'basic', executionMode: 'real', speechPlaybackMode: 'browser', preparedRole: {}, jobContext: null, answerCap: 3, currentQuestionPosition: 1, expiresAt: '2026-10-30', setup: { __typename: 'InterviewSetup', questionCount: 8, questionFormat: 'mixed', difficulty: 'realistic', interviewer: 'daniel', focusAreas: [] }, questions: [], messages: [], operations: [] }
  cache.writeFragment({ id: 'InterviewSession:session', fragment: INTERVIEW_FIELDS, data: current })
  const stale = { ...current, revision: 1, currentQuestionPosition: 0 }
  const nested = key === 'submitInterviewTurn'
  const link = ApolloLink.from([orderedInterviewSnapshots(cache), new ApolloLink(() => new Observable(observer => {
    observer.next({ data: { [key]: nested ? { interview: stale, errors: [] } : stale } }); observer.complete()
  }))])
  await new Promise<void>((resolve, reject) => ApolloLink.execute(link, { query: gql`query Review { revision }` }, { client: {} as never }).subscribe({
    next(result) {
      const value = result.data![key] as typeof current & { interview: typeof current }
      expect((nested ? value.interview : value).revision).toBe(2)
    }, error: reject, complete: resolve,
  }))
})

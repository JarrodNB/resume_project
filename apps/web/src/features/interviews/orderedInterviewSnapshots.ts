/** Preserve newer saved interview progress before transport results enter the Apollo cache. */
import { ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client'
import { INTERVIEW_FIELDS } from './interviewOperations'

export function orderedInterviewSnapshots(cache: InMemoryCache) {
  // Filter stale snapshots before Apollo can normalize their nested records.
  const revisionFragment = gql`fragment SavedInterviewRevision on InterviewSession { revision }`
  return new ApolloLink((operation, forward) => new Observable(observer => {
    const subscription = forward(operation).subscribe({
      next(result) {
        const data = Object.fromEntries(Object.entries(result.data ?? {}).map(([key, value]) => {
          if (!value || typeof value !== 'object') return [key, value]
          const snapshot = value as { __typename?: string; id?: string; revision?: number; interview?: unknown }
          const interview = (snapshot.interview ?? snapshot) as typeof snapshot
          if (interview.__typename !== 'InterviewSession' || typeof interview.revision !== 'number') return [key, value]
          const saved = cache.readFragment<{ revision: number }>({
            id: cache.identify({ __typename: interview.__typename, id: interview.id }), fragment: revisionFragment,
          })
          if (saved && saved.revision > interview.revision) {
            const current = cache.readFragment({ id: cache.identify({ __typename: interview.__typename, id: interview.id }), fragment: INTERVIEW_FIELDS })
            if (current) return [key, snapshot.interview ? { ...snapshot, interview: current } : current]
          }
          return [key, value]
        }))
        observer.next({ ...result, data })
      },
      error: error => observer.error(error),
      complete: () => observer.complete(),
    })
    return () => subscription.unsubscribe()
  }))

}

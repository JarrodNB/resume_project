/** Preserve old interview bookmarks while using the current interview URL. */
import { Navigate, useParams } from 'react-router'

export function LegacyInterviewRedirect() {
  const { id } = useParams()
  return <Navigate to={id ? `/interviews/${id}` : '/interviews'} replace />
}

/** Keeps old bookmarks working after a page moves.
 * Fills the new path pattern with the old URL's params (`/import/:aiTaskId` →
 * `/library/import/:aiTaskId`) and keeps the query string and history state.
 */
import { generatePath, Navigate, useLocation, useParams } from 'react-router'

export function RedirectToPath({ to }: { to: string }) {
  const params = useParams()
  const { search, hash, state } = useLocation()
  return <Navigate to={{ pathname: generatePath(to, params), search, hash }} state={state} replace />
}

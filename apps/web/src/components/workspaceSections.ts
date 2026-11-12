/** Where each signed-in page lives in the navigation.
 *
 * The main navigation has a few sections (Home, Chat, Jobs, Library, Practice). A section with more than one
 * page shows them as tabs in the top bar. A detail page belongs to the tab whose path is its longest matching prefix,
 * so `/jobs/42/resume` keeps "Saved jobs" selected and `/library/import/7` stays in "Career library".
 */
export interface WorkspaceTab { to: string; label: string }
export interface WorkspaceSection { label: string; tabs: WorkspaceTab[] }

export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  { label: 'Home', tabs: [{ to: '/', label: 'Home' }] },
  { label: 'Chat', tabs: [{ to: '/chat', label: 'Chat' }] },
  {
    label: 'Jobs',
    tabs: [
      { to: '/jobs', label: 'Saved jobs' },
      { to: '/jobs/find', label: 'Find jobs' },
      { to: '/resumes', label: 'Resumes' },
    ],
  },
  {
    label: 'Library',
    tabs: [
      { to: '/library', label: 'Career library' },
    ],
  },
  {
    label: 'Practice',
    tabs: [
      { to: '/practice/questions', label: 'Questions' },
      { to: '/practice/interviews', label: 'Mock interview' },
    ],
  },
]

function isWithin(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** Finds the section and tab that own a path, or nulls for pages outside the sections. */
export function locateWorkspacePage(pathname: string): { section: WorkspaceSection | null; tab: WorkspaceTab | null } {
  let best: { section: WorkspaceSection; tab: WorkspaceTab } | null = null
  for (const section of WORKSPACE_SECTIONS) {
    for (const tab of section.tabs) {
      if (isWithin(pathname, tab.to) && (!best || tab.to.length > best.tab.to.length)) best = { section, tab }
    }
  }
  return best ?? { section: null, tab: null }
}

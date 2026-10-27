/** Where each signed-in page lives in the navigation.
 *
 * The sidebar has a few sections (Home, Jobs, Library, Practice). A section with more than one
 * page shows them as tabs in the top bar. A detail page belongs to the tab whose path is its longest matching prefix,
 * so `/jobs/42/resume` keeps "Saved jobs" selected and `/library/import/7` keeps "Import resume".
 */
import { BookOpen, BriefcaseBusiness, House, MessagesSquare, type LucideIcon } from 'lucide-react'

export interface WorkspaceTab { to: string; label: string }
export interface WorkspaceSection { label: string; Icon: LucideIcon; tabs: WorkspaceTab[] }

export const WORKSPACE_SECTIONS: WorkspaceSection[] = [
  { label: 'Home', Icon: House, tabs: [{ to: '/', label: 'Home' }] },
  {
    label: 'Jobs',
    Icon: BriefcaseBusiness,
    tabs: [
      { to: '/jobs', label: 'Saved jobs' },
      { to: '/jobs/find', label: 'Find jobs' },
      { to: '/resumes', label: 'Resumes' },
    ],
  },
  {
    label: 'Library',
    Icon: BookOpen,
    tabs: [
      { to: '/library', label: 'Career library' },
      { to: '/library/import', label: 'Import resume' },
    ],
  },
  {
    label: 'Practice',
    Icon: MessagesSquare,
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

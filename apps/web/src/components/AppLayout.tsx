/** A persistent navigation spine for the user's job-search workspace.
 * The spine lists a few sections (see `workspaceSections.ts`); the top bar shows the current
 * section's tabs (or its name when it has one page), and detail routes keep their parent tab
 * selected. On small screens the spine becomes a compact header and the tabs scroll sideways.
 * In focus mode (a live interview) the spine and tabs step aside for a slim bar with a way out.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { useAuth } from '@/features/auth/useAuth'
import { TaskNotifications } from '@/features/ai-tasks/TaskNotifications'
import { PRODUCT_NAME } from '@/lib/productName'
import { cn } from '@/lib/utils'
import { AccountMenu } from './AccountMenu'
import { FocusModeContext } from './focusModeContext'
import { locateWorkspacePage, WORKSPACE_SECTIONS } from './workspaceSections'

export function AppLayout() {
  const { user, taskOutcomeCursor } = useAuth()
  const { pathname } = useLocation()
  const { section: currentSection, tab: currentTab } = locateWorkspacePage(pathname)
  const tabsRef = useRef<HTMLElement>(null)
  const [focused, setFocused] = useState(false)

  // Keep the selected tab in view when the tab row overflows on small screens.
  useEffect(() => {
    const tabs = tabsRef.current
    const activeTab = tabs?.querySelector<HTMLElement>('[aria-current="page"]')
    if (tabs && activeTab && tabs.scrollWidth > tabs.clientWidth) {
      tabs.scrollLeft = activeTab.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - activeTab.clientWidth) / 2
    }
  }, [pathname])

  // Focus mode swaps only the chrome. The page itself keeps its place in the tree, so a live
  // interview (and any recording in progress) is never remounted when focus turns on or off.
  return (
    <div className={cn('workspace', focused && 'is-focused')}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {focused ? (
        <header className="focus-bar">
          <Link to="/practice/interviews" className="focus-bar-exit"><ArrowLeft aria-hidden /> Leave interview room</Link>
          <span className="focus-bar-brand">{PRODUCT_NAME}</span>
        </header>
      ) : <aside className="workspace-sidebar">
        <Link to="/" className="workspace-brand" aria-label={`${PRODUCT_NAME} home`}>
          <span className="brand-mark" aria-hidden><BookOpen size={21} strokeWidth={1.7} /></span>
          {PRODUCT_NAME}<span className="brand-period" aria-hidden>.</span>
        </Link>
        <nav className="workspace-nav" aria-label="Main navigation">
          {WORKSPACE_SECTIONS.map((section) => {
            const isCurrent = section === currentSection
            return (
              <Link
                key={section.label}
                to={section.tabs[0].to}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn('workspace-nav-link', isCurrent && 'is-active')}
              >
                <section.Icon size={18} strokeWidth={1.7} aria-hidden />
                {section.label}
              </Link>
            )
          })}
        </nav>
        <AccountMenu />
      </aside>}
      <div className="workspace-body">
        {!focused && <header className="workspace-topbar">
          {currentSection && currentSection.tabs.length > 1 ? (
            <nav ref={tabsRef} className="section-tabs" aria-label={`${currentSection.label} pages`}>
              {currentSection.tabs.map((tab) => (
                <Link
                  key={tab.to}
                  to={tab.to}
                  aria-current={tab === currentTab ? 'page' : undefined}
                  className={cn('section-tab', tab === currentTab && 'is-active')}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>
          ) : <span className="section-tabs-placeholder">{currentSection?.label ?? 'Account'}</span>}
          {user && <TaskNotifications key={user.id} userId={user.id} initialCursor={taskOutcomeCursor} />}
        </header>}
        <main id="main-content" tabIndex={-1} className="workspace-content">
          <FocusModeContext value={setFocused}><Outlet /></FocusModeContext>
        </main>
      </div>
    </div>
  )
}

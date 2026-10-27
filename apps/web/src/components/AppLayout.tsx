/** The workspace frame: a black signage band across the top, then the page.
 * The band holds the brand, the few sections (see `workspaceSections.ts`), notifications and the
 * account menu. A section with several pages shows them as tabs under the band, and detail routes
 * keep their parent tab selected. On small screens the sections drop to a second band row that
 * scrolls sideways. In focus mode (a live interview) the band shrinks to a slim bar with a way out.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { ArrowLeft } from 'lucide-react'
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
          <span className="focus-bar-brand"><span className="band-bullet" aria-hidden />{PRODUCT_NAME}</span>
        </header>
      ) : <>
        <header className="signage-band">
          <div className="signage-band-inner">
            <Link to="/" className="band-brand" aria-label={`${PRODUCT_NAME} home`}>
              <span className="band-bullet" aria-hidden />
              {PRODUCT_NAME}
            </Link>
            <nav className="band-nav" aria-label="Main navigation">
              {WORKSPACE_SECTIONS.map((section) => {
                const isCurrent = section === currentSection
                return (
                  <Link
                    key={section.label}
                    to={section.tabs[0].to}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={cn('band-nav-link', isCurrent && 'is-active')}
                  >
                    {section.label}
                  </Link>
                )
              })}
            </nav>
            <div className="band-tools">
              {user && <TaskNotifications key={user.id} userId={user.id} initialCursor={taskOutcomeCursor} />}
              <AccountMenu />
            </div>
          </div>
        </header>
        {currentSection && currentSection.tabs.length > 1 && (
          <nav ref={tabsRef} className="section-tabs" aria-label={`${currentSection.label} pages`}>
            <span className="section-tabs-label" aria-hidden>{currentSection.label}</span>
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
        )}
      </>}
      <div className="workspace-body">
        <main id="main-content" tabIndex={-1} className="workspace-content">
          <FocusModeContext value={setFocused}><Outlet /></FocusModeContext>
        </main>
      </div>
    </div>
  )
}

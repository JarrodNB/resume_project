/** A persistent navigation spine for the user's job-search workspace.
 * Related detail routes keep their parent selected. On small screens the spine
 * becomes a compact header with horizontally scrollable navigation. Job Board discovery
 * has its own location beside the private saved Jobs list.
 */
import { ArrowUpRight, BookOpen, BriefcaseBusiness, FileText, FileUp, LogOut, MessagesSquare, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'
import { PRODUCT_NAME } from '@/lib/productName'
import { cn } from '@/lib/utils'
import { ThemeToggle } from './ThemeToggle'

const NAV_ITEMS = [
  { to: '/library', label: 'Career library', Icon: BookOpen, group: 'Your foundation' },
  { to: '/import', label: 'Import resume', Icon: FileUp, group: 'Your foundation' },
  { to: '/job-board', label: 'Job Board', Icon: Search, group: 'Your applications' },
  { to: '/jobs', label: 'Jobs', Icon: BriefcaseBusiness, group: 'Your applications' },
  { to: '/resumes', label: 'Resumes', Icon: FileText, group: 'Your applications' },
  { to: '/interview-prep', label: 'Interview prep', Icon: MessagesSquare, group: 'Your practice' },
  { to: '/interviews', label: 'Interview', Icon: MessagesSquare, group: 'Your practice' },
]

export function AppLayout() {
  const { signOut } = useAuth()
  const [signOutError, setSignOutError] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError(false)
    try { await signOut() } catch { setSignOutError(true) }
    finally { setSigningOut(false) }
  }
  const { pathname } = useLocation()
  const navigationRef = useRef<HTMLElement>(null)

  // Keep the selected tool in view when the mobile navigation overflows.
  useEffect(() => {
    const navigation = navigationRef.current
    const activeLink = navigation?.querySelector<HTMLElement>('[aria-current="page"]')
    if (navigation && activeLink && navigation.scrollWidth > navigation.clientWidth) {
      navigation.scrollLeft = activeLink.offsetLeft - navigation.offsetLeft - (navigation.clientWidth - activeLink.clientWidth) / 2
    }
  }, [pathname])
  const currentPage = pathname === '/account/security' ? 'Account security' : NAV_ITEMS.find((item) => pathname.startsWith(item.to))?.label ?? 'Workspace'

  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="workspace-sidebar">
        <Link to="/library" className="workspace-brand" aria-label={`${PRODUCT_NAME} home`}>
          <span className="brand-mark" aria-hidden><BookOpen size={21} strokeWidth={1.7} /></span>
          {PRODUCT_NAME}<span className="brand-period" aria-hidden>.</span>
        </Link>
        <nav ref={navigationRef} className="workspace-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item, index) => (
            <div key={item.to} className="workspace-nav-item">
              {(index === 0 || NAV_ITEMS[index - 1].group !== item.group) && <p className="nav-group-label">{item.group}</p>}
              <NavLink to={item.to} className={({ isActive }) => cn('workspace-nav-link', isActive && 'is-active')}>
                <item.Icon size={18} strokeWidth={1.7} aria-hidden />
                {item.label}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="workspace-sidebar-note">
          <p>A little more prepared.<br />One opportunity at a time.</p>
          <Link to="/jobs">Find your next step <ArrowUpRight size={15} aria-hidden /></Link>
        </div>
        <div className="workspace-account">
          <NavLink to="/account/security" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 aria-[current=page]:font-semibold">Account security</NavLink>
          <ThemeToggle />
          <Button variant="ghost" size="sm" disabled={signingOut} onClick={() => void handleSignOut()}><LogOut aria-hidden /> Sign out</Button>
          {signOutError && <p role="alert">Could not sign out. Please try again.</p>}
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <span>Your workspace <span className="breadcrumb-divider" aria-hidden>/</span> <span className="text-foreground">{currentPage}</span></span>
          <span className="workspace-principle">Your experience. Your next chapter.</span>
        </header>
        <main id="main-content" tabIndex={-1} className="workspace-content"><Outlet /></main>
      </div>
    </div>
  )
}

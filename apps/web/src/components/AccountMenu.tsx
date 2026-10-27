/** The signed-in account menu: account security, light/dark theme, and sign out.
 * Sits at the foot of the navigation spine (top right on small screens). Signing out
 * replaces the session; a failure stays visible next to the menu.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronsUpDown, LogOut, Moon, ShieldCheck, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAuth } from '@/features/auth/useAuth'
import { applyColorTheme, preferredColorTheme, type ColorTheme } from '@/lib/colorTheme'

export function AccountMenu() {
  const { user, signOut } = useAuth()
  const [theme, setTheme] = useState<ColorTheme>(preferredColorTheme)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState(false)
  const nextTheme: ColorTheme = theme === 'dark' ? 'light' : 'dark'

  function toggleTheme() {
    applyColorTheme(nextTheme, { remember: true })
    setTheme(nextTheme)
  }

  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError(false)
    try { await signOut() } catch { setSignOutError(true) }
    finally { setSigningOut(false) }
  }

  return (
    <div className="workspace-account">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="account-menu-trigger" aria-label="Account menu">
            <span className="account-menu-email">{user?.email ?? 'Account'}</span>
            <ChevronsUpDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="min-w-56">
          {user && <DropdownMenuLabel className="account-menu-label">{user.email}</DropdownMenuLabel>}
          <DropdownMenuItem asChild>
            <Link to="/account/security"><ShieldCheck aria-hidden /> Account security</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleTheme}>
            {theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />} Switch to {nextTheme} theme
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={signingOut} onSelect={() => void handleSignOut()}>
            <LogOut aria-hidden /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {signOutError && <p role="alert" className="account-menu-error">Could not sign out. Please try again.</p>}
    </div>
  )
}

/** Welcomes users with the same folio identity as the signed-in workspace.
 * The form remains a single focused task, with a compact introduction on mobile.
 */
import type { ReactNode } from 'react'
import { BookOpen, ArrowRight } from 'lucide-react'
import { PRODUCT_NAME } from '@/lib/productName'

interface AuthPageShellProps {
  title: string
  description: string
  footer: ReactNode
  children: ReactNode
}

export function AuthPageShell({ title, description, footer, children }: AuthPageShellProps) {
  return (
    <main className="auth-layout">
      <div className="auth-introduction">
        <p className="workspace-brand"><BookOpen size={24} aria-hidden />{PRODUCT_NAME}<span className="brand-period" aria-hidden>.</span></p>
        <div className="auth-message">
          <h1>Your experience.<br />Your next chapter.</h1>
          <p>Bring your career story together. Shape it for the opportunities that matter to you.</p>
          <ol className="auth-workflow">
            <li><span>Build your career library</span><BookOpen size={18} aria-hidden /></li>
            <li><span>Tailor a resume for a role</span><ArrowRight size={18} aria-hidden /></li>
            <li><span>Prepare for the conversation</span><ArrowRight size={18} aria-hidden /></li>
          </ol>
        </div>
        <p className="auth-caption">Grounded in your experience. Refined with you.</p>
      </div>
      <div className="auth-form-region">
        <div className="auth-form-content">
          <header className="mb-8"><h2 className="text-3xl font-semibold tracking-tight">{title}</h2><p className="mt-3 text-muted-foreground">{description}</p></header>
          {children}
          <footer className="mt-8 border-t pt-6 text-sm text-muted-foreground">{footer}</footer>
        </div>
      </div>
    </main>
  )
}

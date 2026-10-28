/** Welcomes users with the same Transit Line look as the signed-in workspace.
 * A black signage panel names the product and draws the three steps of a search as stops on
 * one line; the form beside it stays a single focused task. Phones show a compact panel on top.
 */
import type { ReactNode } from 'react'
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
        <p className="band-brand"><span className="band-bullet" aria-hidden />{PRODUCT_NAME}</p>
        <div className="auth-message">
          <h1>Your experience.<br />Your next chapter.</h1>
          <p>Bring your career story together. Shape it for the opportunities that matter to you.</p>
          <ol className="auth-workflow">
            <li>Build your career library</li>
            <li>Tailor a resume for a role</li>
            <li>Prepare for the conversation</li>
          </ol>
        </div>
        <p className="auth-caption">Grounded in your experience. Refined with you.</p>
      </div>
      <div className="auth-form-region">
        <div className="auth-form-content">
          <header className="auth-form-heading"><h2>{title}</h2><p>{description}</p></header>
          {children}
          <footer className="mt-8 border-t pt-6 text-sm text-muted-foreground">{footer}</footer>
        </div>
      </div>
    </main>
  )
}

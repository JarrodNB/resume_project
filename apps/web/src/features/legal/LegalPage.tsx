/** Shared readable layout for the public privacy policy and terms pages. Works signed in or out. */
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { PRODUCT_NAME } from '@/lib/productName'
import { LEGAL_EFFECTIVE_DATE } from './legalDetails'

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal-page">
      <nav aria-label="Legal" className="legal-nav">
        <Link to="/" className="band-brand"><span className="band-bullet" aria-hidden />{PRODUCT_NAME}</Link>
        <span className="legal-nav-links"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></span>
      </nav>
      <article className="legal-article">
        <h1>{title}</h1>
        <p className="legal-effective">Effective {LEGAL_EFFECTIVE_DATE}</p>
        {children}
      </article>
    </main>
  )
}

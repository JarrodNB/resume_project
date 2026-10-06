/**
 * Description: Centered card layout shared by the sign-in and sign-up pages.
 * Index:
 *   - AuthPageShell: page frame with brand, title, description, and footer
 */
import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { PRODUCT_NAME } from '@/lib/productName'

interface AuthPageShellProps {
  title: string
  description: string
  footer: ReactNode
  children: ReactNode
}

/** Renders an auth form inside a centered card under the product name. */
export function AuthPageShell({ title, description, footer, children }: AuthPageShellProps) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-6">
      <p className="text-lg font-semibold tracking-tight">{PRODUCT_NAME}</p>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">{footer}</CardFooter>
      </Card>
    </main>
  )
}

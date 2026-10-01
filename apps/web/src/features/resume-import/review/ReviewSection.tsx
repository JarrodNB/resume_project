/**
 * Description: Card wrapper for one section of the parsed resume review form.
 * Index:
 *   - ReviewSection: titled card with optional description
 */
import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ReviewSectionProps {
  title: string
  description?: string
  children: ReactNode
}

/** Renders a titled card around a group of review fields. */
export function ReviewSection({ title, description, children }: ReviewSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  )
}

/** Gives signup and password changes the same short hint; the server explains rejected passwords. */
export function PasswordGuidance({ id }: { id: string }) {
  return (
    <p id={id} className="text-sm text-muted-foreground">
      At least 15 characters.
    </p>
  )
}

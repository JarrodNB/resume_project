/** Gives signup and password changes the same short hint; the server explains rejected passwords. */

/** Shortest new password the API accepts (Devise `password_length` in services/api/config/initializers/devise.rb). */
export const NEW_PASSWORD_MIN_LENGTH = 15

export function PasswordGuidance({ id }: { id: string }) {
  return (
    <p id={id} className="text-sm text-muted-foreground">
      At least {NEW_PASSWORD_MIN_LENGTH} characters.
    </p>
  )
}

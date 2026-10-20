/** Captures recovery secrets before app startup; history and URLs keep no token afterward. */
let resetPasswordToken: string | null = null
export function captureResetPasswordToken() {
  if (location.pathname !== '/reset-password') return
  resetPasswordToken = new URLSearchParams(location.hash.slice(1)).get('reset_password_token')
  if (location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}`)
}
export function readResetPasswordToken() { return resetPasswordToken }
export function forgetResetPasswordToken() { resetPasswordToken = null }

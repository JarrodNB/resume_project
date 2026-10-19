/** Captures email-link secrets before app startup and immediately removes browser history fragments. */
let confirmationToken: string | null = null

export function captureConfirmationToken() {
  if (location.pathname !== '/verify-email') return
  confirmationToken = new URLSearchParams(location.hash.slice(1)).get('confirmation_token')
  if (location.hash) history.replaceState(history.state, '', `${location.pathname}${location.search}`)
}
export function readConfirmationToken() { return confirmationToken }
export function forgetConfirmationToken() { confirmationToken = null }

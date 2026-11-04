/** Where the landing page's links lead. The web app's address differs per environment, so it
 * comes from VITE_APP_URL at build time. Production builds refuse to run without it (see
 * vite.config.ts), so the fallback only ever applies to local development.
 */
const APP_URL = import.meta.env.VITE_APP_URL ?? 'http://localhost:5173'

export const SIGN_UP_URL = `${APP_URL}/sign-up`
export const SIGN_IN_URL = `${APP_URL}/sign-in`

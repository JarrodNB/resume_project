/** The demo route and navigation require an explicit development build setting. Rails checks independently. */
export function interviewDemoEnabled() {
  return import.meta.env.DEV && import.meta.env.VITE_INTERVIEW_DEMO_ENABLED === 'true'
}

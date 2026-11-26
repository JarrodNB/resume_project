/**
 * Description: Tells whether a link is safe to open from the app: only http and https
 * addresses are. Anything else (javascript:, data:, vbscript:) could run script when clicked.
 */

/** True for an absolute http or https URL. */
export function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value.trim())
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** True when the text names a URL scheme such as "javascript:", but not a dotted "host.com:8080" address. */
export function hasUrlScheme(value: string): boolean {
  const trimmed = value.trim()
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^(?:[\w-]+\.)+[\w-]+:\d/.test(trimmed)
}

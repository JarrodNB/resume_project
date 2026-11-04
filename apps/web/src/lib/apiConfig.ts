/**
 * Description: URLs of the Rails API, from VITE_API_URL (defaults to the local docker compose API).
 * Index:
 *   - API_URL: base URL for REST auth endpoints
 *   - GRAPHQL_URL: GraphQL HTTP endpoint
 *   - CABLE_URL: ActionCable WebSocket endpoint for GraphQL subscriptions
 *   - TURNSTILE_SITE_KEY: public key for the sign-up bot check, from VITE_TURNSTILE_SITE_KEY. Defaults
 *     to Cloudflare's always-pass test key, which a production server secret rejects.
 */

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '1x00000000000000000000AA'

export const GRAPHQL_URL = `${API_URL}/graphql`

export const CABLE_URL = `${API_URL.replace(/^http/, 'ws')}/cable`

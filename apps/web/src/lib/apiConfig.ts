/**
 * Description: URLs of the Rails API, from VITE_API_URL (defaults to the local docker compose API).
 * Index:
 *   - API_URL: base URL for REST auth endpoints
 *   - GRAPHQL_URL: GraphQL HTTP endpoint
 *   - CABLE_URL: ActionCable WebSocket endpoint for GraphQL subscriptions
 */

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export const GRAPHQL_URL = `${API_URL}/graphql`

export const CABLE_URL = `${API_URL.replace(/^http/, 'ws')}/cable`

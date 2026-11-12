/** Downloads a copy of everything the signed-in user saved (see Rails `Accounts::ExportAccountDataService`). */
import { graphql } from '@/graphql/generated'

export const ACCOUNT_EXPORT_QUERY = graphql(`
  query AccountExport {
    accountExport
  }
`)

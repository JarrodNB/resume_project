/**
 * Description: GraphQL Code Generator config. Reads the schema dumped by Rails
 * (services/api/schema.graphql) and the `graphql(...)` operations in src/, and writes typed
 * documents to src/graphql/generated/. Run with `docker compose exec web npm run codegen`.
 * Index:
 *   - default export: codegen config (client preset)
 */
import type { CodegenConfig } from '@graphql-codegen/cli'

const config: CodegenConfig = {
  schema: '../../services/api/schema.graphql',
  documents: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/graphql/generated/**'],
  ignoreNoDocuments: true,
  generates: {
    './src/graphql/generated/': {
      preset: 'client',
      presetConfig: { fragmentMasking: false },
      config: {
        enumsAsTypes: true,
        useTypeImports: true,
        scalars: {
          ISO8601Date: 'string',
          ISO8601DateTime: 'string',
          JSON: 'unknown',
          Upload: 'File',
        },
      },
    },
  },
}

export default config

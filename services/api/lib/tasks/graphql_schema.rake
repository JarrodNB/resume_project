# Description: Dumps the GraphQL schema as SDL to graphql_schema/schema.graphql, the input for the
# web app's GraphQL Code Generator. The file lives in its own folder so the web container can mount
# the folder (a single-file mount keeps showing the old file once it is replaced). Run after any GraphQL change:
# `docker compose run --rm api bin/rails graphql:schema:dump`.
# Index:
#   - graphql:schema:dump: writes ApiSchema.to_definition to graphql_schema/schema.graphql
namespace :graphql do
  namespace :schema do
    desc "Write the GraphQL schema (SDL) to graphql_schema/schema.graphql"
    task dump: :environment do
      path = Rails.root.join("graphql_schema", "schema.graphql")
      File.write(path, ApiSchema.to_definition)
      puts "Wrote #{path}"
    end
  end
end

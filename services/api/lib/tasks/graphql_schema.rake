# Description: Dumps the GraphQL schema as SDL to schema.graphql, the input for the web app's
# GraphQL Code Generator. Run after any GraphQL change:
# `docker compose run --rm api bin/rails graphql:schema:dump`.
# Index:
#   - graphql:schema:dump: writes ApiSchema.to_definition to schema.graphql
namespace :graphql do
  namespace :schema do
    desc "Write the GraphQL schema (SDL) to schema.graphql"
    task dump: :environment do
      path = Rails.root.join("schema.graphql")
      File.write(path, ApiSchema.to_definition)
      puts "Wrote #{path}"
    end
  end
end

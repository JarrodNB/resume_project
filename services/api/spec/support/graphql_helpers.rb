# Description: Helpers for running GraphQL operations directly against the schema in specs.
# Index:
#   - execute_graphql: runs a query/mutation as a user and returns the result hash
module GraphqlHelpers
  # Runs a GraphQL operation as `user` and returns the result as a plain hash.
  def execute_graphql(query, user:, variables: {})
    ApiSchema.execute(query, variables: variables, context: { current_user: user }).to_h
  end
end

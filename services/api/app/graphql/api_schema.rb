# frozen_string_literal: true

# Description: Root GraphQL schema. Every request is authenticated (see GraphqlController),
# and every root field is scoped to `context[:current_user]`.
# Index:
#   - rescue_from RecordNotFound: returns a "not found" GraphQL error instead of a 500
class ApiSchema < GraphQL::Schema
  mutation(Types::MutationType)
  query(Types::QueryType)

  use GraphQL::Dataloader

  max_depth(15)
  max_query_string_tokens(5000)
  validate_max_errors(100)

  rescue_from(ActiveRecord::RecordNotFound) do
    raise GraphQL::ExecutionError, "Record not found"
  end
end

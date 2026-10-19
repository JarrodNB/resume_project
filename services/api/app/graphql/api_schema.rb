# frozen_string_literal: true

# Description: Root GraphQL schema. Every request is authenticated (see GraphqlController and
# ApplicationCable::Connection), and private records are scoped to `context[:current_user]`.
# Job Board operations may read shared provider data; saved Jobs remain private.
# Subscriptions are delivered over ActionCable (GraphqlChannel).
# Index:
#   - rescue_from RecordNotFound: returns a "not found" GraphQL error instead of a 500
class ApiSchema < GraphQL::Schema
  mutation(Types::MutationType)
  query(Types::QueryType)
  subscription(Types::SubscriptionType)

  use GraphQL::Dataloader
  use GraphQL::Subscriptions::ActionCableSubscriptions

  max_depth(15)
  max_query_string_tokens(5000)
  validate_max_errors(100)

  rescue_from(ActiveRecord::RecordNotFound) do
    raise GraphQL::ExecutionError, "Record not found"
  end
end

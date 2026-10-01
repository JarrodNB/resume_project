# Description: ActionCable channel that runs GraphQL operations (mainly subscriptions) for the
# connected user. Follows the graphql-ruby ActionCableSubscriptions protocol used by Apollo.
# Index:
#   - subscribed: starts tracking this channel's GraphQL subscriptions
#   - execute: runs one operation and transmits {result, more}
#   - unsubscribed: removes this channel's GraphQL subscriptions
class GraphqlChannel < ApplicationCable::Channel
  # Starts with no GraphQL subscriptions.
  def subscribed
    @subscription_ids = []
  end

  # Runs a GraphQL operation as the connected user and transmits the result.
  def execute(data)
    result = ApiSchema.execute(
      data["query"],
      variables: data["variables"] || {},
      operation_name: data["operationName"],
      context: { current_user: current_user, channel: self }
    )
    @subscription_ids << result.context[:subscription_id] if result.context[:subscription_id]
    transmit({ result: result.to_h, more: result.subscription? })
  end

  # Cleans up every GraphQL subscription opened on this channel.
  def unsubscribed
    @subscription_ids.each { |subscription_id| ApiSchema.subscriptions.delete_subscription(subscription_id) }
  end
end

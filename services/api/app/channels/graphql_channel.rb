# Description: ActionCable channel that runs GraphQL operations (mainly subscriptions) for the
# connected user. Task-outcome baselines wait for actual pubsub readiness, then refresh
# their cursor so a completion during registration cannot fall through the gap. Follows the graphql-ruby ActionCableSubscriptions protocol used by Apollo.
# Index:
#   - subscribed: starts tracking this channel's GraphQL subscriptions
#   - execute: runs one operation and transmits {result, more}
#   - unsubscribed: removes this channel's GraphQL subscriptions
class GraphqlChannel < ApplicationCable::Channel
  # Starts with no GraphQL subscriptions.
  def subscribed
    @subscription_ids = []
    @outcome_handshakes = []
    @outcome_handshake_mutex = Mutex.new
  end

  # Runs a GraphQL operation as the connected user and transmits the result.
  def execute(data)
    return connection.check_session unless connection.session_valid?
    result = ApiSchema.execute(
      data["query"],
      variables: data["variables"] || {},
      operation_name: data["operationName"],
      context: { current_user: current_user, current_user_id: current_user.id, channel: self }
    )
    subscription_id = result.context[:subscription_id]
    @subscription_ids << subscription_id if subscription_id
    if subscription_id && result.context[:task_outcome_handshake]
      event = result.context.namespace(:subscriptions).fetch(:events).first
      @outcome_handshake_mutex.synchronize { @outcome_handshakes << [ subscription_id, event ] }
      flush_ready_outcome_handshakes
    else
      transmit({ result: result.to_h, more: result.subscription? })
    end
  end

  # Subscription broadcasts bypass execute; guard their delivery as well.
  # The inherited method logs raw result.inspect, including private transcripts.
  def transmit(data, via: nil)
    return connection.check_session unless connection.session_valid?
    logger.debug "GraphqlChannel transmitting a private result"
    ActiveSupport::Notifications.instrument("transmit.action_cable",
      channel_class: self.class.name, data: data, via: via) do
      connection.transmit(identifier: identifier, message: data)
    end
  end

  # Cleans up every GraphQL subscription opened on this channel.
  def unsubscribed
    @subscription_ids.each { |subscription_id| ApiSchema.subscriptions.delete_subscription(subscription_id) }
    @outcome_handshake_mutex.synchronize { @outcome_handshakes.clear }
  end

  private

  # ActionCable calls this after each pubsub subscription confirms. Its atomic
  # counter also covers confirmations that arrive before GraphQL execution returns.
  def ensure_confirmation_sent
    super
    flush_ready_outcome_handshakes if @outcome_handshake_mutex
  end

  def flush_ready_outcome_handshakes
    ready = @outcome_handshake_mutex.synchronize do
      next [] if defer_subscription_confirmation? || unsubscribed? || subscription_rejected?
      @outcome_handshakes.shift(@outcome_handshakes.length)
    end
    ready.each do |subscription_id, event|
      # Stream confirmations run on the event loop; database/GraphQL work belongs
      # on the worker pool just like ordinary subscription updates.
      connection.worker_pool.async_invoke(self, :deliver_task_outcome_handshake, subscription_id, event,
        connection: connection)
    end
  end

  def deliver_task_outcome_handshake(subscription_id, event)
    return if unsubscribed?
    return connection.check_session unless connection.session_valid?
    snapshot = { cursor: (current_user.ai_task_outcomes.maximum(:sequence) || 0).to_s, outcome: nil }
    result = ApiSchema.subscriptions.execute_update(subscription_id, event, snapshot)
    # Reuse GraphQL's saved operation so aliases and fragments keep their shape.
    transmit({ result: result.to_h, more: true }) if result
  end
end

# Description: ActionCable channel that runs only GraphQL subscriptions for the
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
    @subscription_reservations = {}
    @subscription_budget = ApplicationCable::SubscriptionBudget.for_connection(connection)
    @outcome_handshakes = []
    @outcome_handshake_mutex = Mutex.new
  end

  # HTTP owns queries and mutations, including their CSRF and rate-limit checks.
  def execute(data)
    return connection.check_session unless connection.session_valid?
    operation = GraphQL::Query.new(ApiSchema, data["query"], operation_name: data["operationName"]) if data["query"].is_a?(String)
    unless operation&.subscription?
      transmit({ result: { errors: [ { message: "Cable accepts subscriptions only" } ] }, more: false })
      return
    end
    reservation = @subscription_budget.acquire
    unless reservation
      transmit({ result: { errors: [ { message: "Too many active subscriptions" } ] }, more: false })
      return
    end
    result = ApiSchema.execute(
      data["query"],
      variables: data["variables"] || {},
      operation_name: data["operationName"],
      context: { current_user: current_user, current_user_id: current_user.id, channel: self }
    )
    subscription_id = result.context[:subscription_id]
    if subscription_id
      retained = @outcome_handshake_mutex.synchronize do
        next false if unsubscribed?
        @subscription_ids << subscription_id
        @subscription_reservations[subscription_id] = reservation
        true
      end
      unless retained
        ApiSchema.subscriptions.delete_subscription(subscription_id)
        return
      end
    end
    if subscription_id && result.context[:task_outcome_handshake]
      event = result.context.namespace(:subscriptions).fetch(:events).first
      @outcome_handshake_mutex.synchronize { @outcome_handshakes << [ subscription_id, event ] }
      flush_ready_outcome_handshakes
    else
      transmit({ result: result.to_h, more: result.subscription? })
    end
  ensure
    @subscription_budget.release(reservation) if reservation && !retained
  end

  # Subscription broadcasts bypass execute; guard their delivery as well.
  def transmit(data, **options)
    return connection.check_session unless connection.session_valid?
    super
  end

  # Cleans up every GraphQL subscription opened on this channel.
  def unsubscribed
    ids, reservations = @outcome_handshake_mutex.synchronize do
      saved = [ @subscription_ids.dup, @subscription_reservations.values ]
      @subscription_ids.clear
      @subscription_reservations.clear
      @outcome_handshakes.clear
      saved
    end
    ids.each { |subscription_id| ApiSchema.subscriptions.delete_subscription(subscription_id) }
  ensure
    reservations&.each { |reservation| @subscription_budget.release(reservation) }
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

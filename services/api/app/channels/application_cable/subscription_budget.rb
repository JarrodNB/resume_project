# Bounds retained GraphQL subscriptions across every channel on one socket.
# Reservations are atomic and released by token so repeated cleanup cannot free
# another channel's slot. The budget disappears with its connection.
module ApplicationCable
  class SubscriptionBudget
    MAX_SUBSCRIPTIONS = 50
    INITIALIZATION_MUTEX = Mutex.new

    def self.for_connection(connection)
      INITIALIZATION_MUTEX.synchronize do
        connection.instance_variable_get(:@graphql_subscription_budget) ||
          connection.instance_variable_set(:@graphql_subscription_budget, new)
      end
    end

    def initialize
      @mutex = Mutex.new
      @reservations = {}
    end

    def acquire
      @mutex.synchronize do
        return if @reservations.size >= MAX_SUBSCRIPTIONS
        token = Object.new
        @reservations[token] = true
        token
      end
    end

    def release(token)
      @mutex.synchronize { @reservations.delete(token) }
    end
  end
end

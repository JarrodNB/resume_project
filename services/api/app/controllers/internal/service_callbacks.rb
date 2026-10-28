# Shared guards for private service-to-service callbacks (AI service -> Rails).
# Requests must carry the Bearer secret the controller names in `service_secret`, and every
# request runs with short database lock and statement timeouts so a stuck row lock turns
# into a retryable 503 instead of a hung worker. Controllers add their own `service_busy_message`.
module Internal
  module ServiceCallbacks
    extend ActiveSupport::Concern

    included do
      before_action :authenticate_service
      around_action :bound_database_waits
    end

    private

    # The secret callers must send. Override per controller.
    def service_secret
      ENV["INTERVIEW_SERVICE_SECRET"]
    end

    def service_busy_message
      "Service is busy; retry the same request"
    end

    def authenticate_service
      expected = service_secret
      authorization = request.headers["Authorization"].to_s
      supplied = authorization.delete_prefix("Bearer ")
      unless authorization.start_with?("Bearer ") && expected.present? && supplied.present? && ActiveSupport::SecurityUtils.secure_compare(supplied, expected)
        render json: { errors: [ "Unauthorized" ] }, status: :unauthorized
      end
      response.set_header("Cache-Control", "no-store")
    end

    # Restore connection limits before returning it to the pool. The request itself
    # must not hold a transaction open across media I/O after service locks release.
    def bound_database_waits
      ApplicationRecord.connection_pool.with_connection do |connection|
        previous_lock = connection.select_value("SHOW lock_timeout")
        previous_statement = connection.select_value("SHOW statement_timeout")
        begin
          connection.execute("SET lock_timeout = '2s'")
          connection.execute("SET statement_timeout = '5s'")
          yield
        ensure
          connection.execute("SET lock_timeout = #{connection.quote(previous_lock)}")
          connection.execute("SET statement_timeout = #{connection.quote(previous_statement)}")
        end
      end
    rescue ActiveRecord::LockWaitTimeout, ActiveRecord::QueryCanceled
      render json: { errors: [ service_busy_message ] }, status: :service_unavailable
    end
  end
end

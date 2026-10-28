# Service-authenticated callbacks resolve the persisted chat owner, never browser-supplied identity.
module Internal
  class ChatController < ActionController::API
    before_action :authenticate_service
    around_action :bound_database_waits
    before_action :find_operation
    rescue_from ActiveRecord::RecordNotFound, with: -> { render json: { errors: ["Record not found"] }, status: :not_found }
    rescue_from ActionController::ParameterMissing, with: -> { render json: { errors: ["Missing parameter"] }, status: :unprocessable_entity }

    def claim
      respond ::Chat::ClaimOperationService.call(operation: @operation)
    end
    def heartbeat
      respond ::Chat::RenewClaimService.call(operation: @operation, **identity)
    end
    def accept
      respond ::Chat::AcceptReplyService.call(operation: @operation, **identity, reply: params.require(:reply), screened_message_sha256: params.require(:screened_message_sha256))
    end
    def fail
      respond ::Chat::FailOperationService.call(operation: @operation, **identity, code: params.require(:code), retryable: params.fetch(:retryable, false))
    end
    def start_provider
      respond ::Chat::StartProviderAttemptService.call(operation: @operation, **identity, observation_id: params.require(:observation_id), stage: params.require(:stage), provider: params.require(:provider), model: params.require(:model))
    end
    def usage
      entries = params[:usage]
      entries = entries.map { |entry| entry.respond_to?(:to_unsafe_h) ? entry.to_unsafe_h : entry } if entries.is_a?(Array)
      respond ::Chat::RecordUsageService.call(operation: @operation, attempt_id: params.require(:attempt_id), usage: entries, incomplete: params.fetch(:incomplete, false), observation_id: params[:observation_id])
    end
    def status
      render json: { operation_id: @operation.id, status: @operation.status, accepted_result: @operation.accepted_result,
        execution_count: @operation.execution_count, failure_code: @operation.failure_code, retry_at: @operation.retry_at }
    end

    private
    def authenticate_service
      expected = ENV["AI_EXECUTION_SERVICE_SECRET"].presence || ENV["INTERVIEW_SERVICE_SECRET"]
      authorization = request.headers["Authorization"].to_s
      supplied = authorization.delete_prefix("Bearer ")
      unless authorization.start_with?("Bearer ") && expected.present? && supplied.present? && ActiveSupport::SecurityUtils.secure_compare(supplied, expected)
        render json: { errors: ["Unauthorized"] }, status: :unauthorized
      end
      response.set_header("Cache-Control", "no-store")
    end
    def find_operation
      @operation = ChatOperation.find(params[:id])
    end
    def identity
      { attempt_id: params.require(:attempt_id), claim_generation: params.require(:claim_generation) }
    end
    def respond(result)
      render json: result.success? ? result.value : { errors: result.errors }, status: result.success? ? :ok : :conflict
    end
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
      render json: { errors: ["Chat service busy; retry the same request"] }, status: :service_unavailable
    end
  end
end

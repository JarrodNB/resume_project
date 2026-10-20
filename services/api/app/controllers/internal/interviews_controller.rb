# Private machine-to-machine execution callbacks. This controller has no browser
# authentication or user-ID authority; every operation resolves its persisted owner.
module Internal
  class InterviewsController < ActionController::API
    before_action :authenticate_service
    around_action :bound_database_waits
    before_action :find_operation, except: :discover
    rescue_from ActiveRecord::RecordNotFound, with: -> { render json: { errors: [ "Record not found" ] }, status: :not_found }
    rescue_from ActionController::ParameterMissing, with: -> { render json: { errors: [ "Missing parameter" ] }, status: :unprocessable_entity }

    def discover
      render json: { operation_ids: Interviews::DiscoverOperationsService.call.value }
    end

    def claim
      respond Interviews::ClaimOperationService.call(operation: @operation)
    end

    def heartbeat
      respond Interviews::RenewClaimService.call(operation: @operation, **claim_identity, checkpoint: params[:checkpoint])
    end

    def accept
      respond Interviews::AcceptTurnService.call(operation: @operation, **claim_identity,
        transcript: params.require(:transcript), decision: params.require(:decision), reply: params[:reply],
        history_version: params.require(:history_version), model_history: params[:model_history].as_json)
    end

    def fail
      respond Interviews::FailOperationService.call(operation: @operation, **claim_identity,
        code: params.require(:code), retryable: params[:retryable])
    end

    def usage
      entries = params[:usage]
      entries = entries.map { |entry| entry.respond_to?(:to_unsafe_h) ? entry.to_unsafe_h : entry } if entries.is_a?(Array)
      respond Interviews::RecordUsageService.call(operation: @operation, attempt_id: params.require(:attempt_id),
        usage: entries, incomplete: params.fetch(:incomplete, false), observation_id: params[:observation_id])
    end

    def start_provider
      respond Interviews::StartProviderAttemptService.call(operation: @operation, **claim_identity,
        observation_id: params.require(:observation_id), stage: params.require(:stage),
        provider: params.require(:provider), model: params.require(:model))
    end

    def status
      respond Interviews::OperationStatusService.call(operation: @operation)
    end

    def retry
      result = Interviews::RetryOperationService.call(operation: @operation)
      respond(result.success? ? Interviews::OperationStatusService.call(operation: @operation) : result)
    end

    private

    def authenticate_service
      expected = ENV["INTERVIEW_SERVICE_SECRET"]
      authorization = request.headers["Authorization"].to_s
      supplied = authorization.delete_prefix("Bearer ")
      unless authorization.start_with?("Bearer ") && expected.present? && supplied.present? && ActiveSupport::SecurityUtils.secure_compare(supplied, expected)
        render json: { errors: [ "Unauthorized" ] }, status: :unauthorized
      end
      response.set_header("Cache-Control", "no-store")
    end

    # PostgreSQL cancels waits safely inside a savepoint; Ruby Timeout cannot safely
    # interrupt a database transaction. Restore settings for pooled connections.
    def bound_database_waits
      ApplicationRecord.connection_pool.with_connection do |connection|
        connection.transaction(requires_new: true) do
          previous_lock = connection.select_value("SHOW lock_timeout")
          previous_statement = connection.select_value("SHOW statement_timeout")
          connection.execute("SET LOCAL lock_timeout = '2s'")
          connection.execute("SET LOCAL statement_timeout = '5s'")
          yield
          connection.execute("SET LOCAL lock_timeout = #{connection.quote(previous_lock)}")
          connection.execute("SET LOCAL statement_timeout = #{connection.quote(previous_statement)}")
        end
      end
    rescue ActiveRecord::LockWaitTimeout, ActiveRecord::QueryCanceled
      render json: { errors: [ "Interview service is busy; retry the same request" ] }, status: :service_unavailable
    end

    def find_operation
      @operation = InterviewSessionOperation.find(params[:id])
    end

    def claim_identity
      { attempt_id: params.require(:attempt_id), claim_generation: params.require(:claim_generation) }
    end

    def respond(result)
      render json: result.success? ? result.value : { errors: result.errors }, status: result.success? ? :ok : :conflict
    end
  end
end

# Service-authenticated callbacks resolve the persisted chat owner, never browser-supplied identity.
module Internal
  class ChatController < ActionController::API
    include ServiceCallbacks
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
      respond ::Chat::AcceptReplyService.call(operation: @operation, **identity, reply: params.require(:reply), screened_message_sha256: params.require(:screened_message_sha256),
        career_context: params[:career_context].respond_to?(:to_unsafe_h) ? params[:career_context].to_unsafe_h : params[:career_context],
        record_screening: Array(params[:record_screening]).map { |report| report.respond_to?(:to_unsafe_h) ? report.to_unsafe_h : report },
        summary_update: params[:summary_update].respond_to?(:to_unsafe_h) ? params[:summary_update].to_unsafe_h : params[:summary_update])
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

    def service_secret
      ENV["AI_EXECUTION_SERVICE_SECRET"].presence || ENV["INTERVIEW_SERVICE_SECRET"]
    end

    def service_busy_message
      "Chat service busy; retry the same request"
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
  end
end

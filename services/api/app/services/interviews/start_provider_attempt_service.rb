# Reserves a separate billing identity before each potentially charged provider call.
# Repeated starts are idempotent; an expired execution cannot start another call.
# Denied spend stops discovery and preserves valid media for an explicit retry.
module Interviews
  class StartProviderAttemptService < ApplicationService
    include ExecutionPolicy
    STAGES = %w[transcription screening interviewer speech].freeze
    MAX_PROVIDER_ATTEMPTS = Integer(ENV.fetch("INTERVIEW_PROVIDER_ATTEMPT_LIMIT", "8")).clamp(1, 20)

    def initialize(operation:, attempt_id:, claim_generation:, observation_id:, stage:, provider:, model:)
      @operation, @attempt_id, @generation = operation, attempt_id, claim_generation
      @observation_id, @stage, @provider, @model = observation_id, stage, provider, model
    end

    def call
      return failure("Invalid provider start") unless valid_input?

      with_operation_lock do |interview|
        next failure("Interview abandoned") if interview.abandoned?
        execution = @operation.execution_attempts.find_by(attempt_id: @attempt_id, claim_generation: @generation)
        next failure("Unknown execution") unless execution
        existing = execution.provider_attempts.find_by(observation_id: @observation_id)
        if existing
          next existing.attributes.slice("stage", "provider", "model") == labels ? success({ observation_id: @observation_id }) : failure("Provider start conflicts")
        end
        next failure("Claim is stale or expired") unless current_claim?
        next failure("Provider attempt limit reached") if execution.provider_attempts.count >= MAX_PROVIDER_ATTEMPTS
        next failure("Provider identity already used") if AiUsageAttempt.exists?(attempt_id: @observation_id)
        if interview.execution_mode == "real"
          allowance = CheckOperationAllowanceService.call(operation: @operation)
          unless allowance.success?
            reject_allowance(expiry: @operation.retry_expires_at)
            next allowance
          end
          unless VerificationBudget.reserve(observation_id: @observation_id, stage: @stage, provider: @provider, model: @model)
            reject_allowance(expiry: @operation.retry_expires_at)
            next failure("Verification budget or provider pricing unavailable")
          end
        elsif @provider != "fake"
          next failure("Fake execution cannot start paid providers")
        end
        execution.provider_attempts.create!(observation_id: @observation_id, **labels)
        AiTasks::RecordAttemptUsageService.call(ai_task: @operation.ai_task,
          message: { "attempt_id" => @observation_id, "attempt_finished" => false })
        success({ observation_id: @observation_id })
      end
    rescue ActiveRecord::RecordNotUnique
      failure("Provider identity already belongs to another execution")
    end

    private

    def labels
      { "stage" => @stage, "provider" => @provider, "model" => @model }
    end

    def valid_input?
      @observation_id.is_a?(String) && @observation_id.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/) &&
        STAGES.include?(@stage) && [ @provider, @model ].all? { |label| label.is_a?(String) && label.length.between?(1, 100) }
    end
  end
end

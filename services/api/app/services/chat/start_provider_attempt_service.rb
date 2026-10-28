# Register a durable unknown charge before every chat provider dispatch, under the general allowance.
module Chat
  class StartProviderAttemptService < ApplicationService
    include ExecutionPolicy
    MODELS = { "screening" => { "typesafe" => %w[jev-1.13.0], "openai" => %w[gpt-5-nano] },
      "reply" => { "openai" => %w[gpt-6-luna gpt-5-nano] }, "summary" => { "openai" => %w[gpt-6-luna gpt-5-nano] } }.freeze
    def initialize(operation:, attempt_id:, claim_generation:, observation_id:, stage:, provider:, model:)
      @operation, @attempt_id, @generation, @observation_id = operation, attempt_id, claim_generation, observation_id
      @stage, @provider, @model = stage, provider, model
    end
    def call
      return failure("Invalid provider start") unless @observation_id.is_a?(String) && @observation_id.match?(/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/) && MODELS.dig(@stage, @provider)&.include?(@model)
      with_operation_lock do |conversation|
        execution = @operation.execution_attempts.find_by(attempt_id: @attempt_id, claim_generation: @generation)
        next failure("Unknown execution") unless execution
        labels = { "stage" => @stage, "provider" => @provider, "model" => @model }
        previous = execution.provider_attempts.find_by(observation_id: @observation_id)
        next(previous.attributes.slice(*labels.keys) == labels ? success({ observation_id: @observation_id }) : failure("Provider start conflicts")) if previous
        next failure("Claim is stale or expired") unless current_claim?
        next failure("Provider attempt limit reached") if execution.provider_attempts.count >= 12
        next failure("Provider identity already used") if AiUsageAttempt.exists?(attempt_id: @observation_id)
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: conversation.user, existing_task: @operation.ai_task)
        next allowance unless allowance.success?
        execution.provider_attempts.create!(observation_id: @observation_id, **labels)
        AiTasks::RecordAttemptUsageService.call(ai_task: @operation.ai_task,
          message: { "attempt_id" => @observation_id, "attempt_finished" => false })
        success({ observation_id: @observation_id })
      end
    rescue ActiveRecord::RecordNotUnique
      failure("Provider identity already used")
    end
  end
end

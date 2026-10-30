# Starts explicit generation under the shared task allowance and owner lock. Matching
# queued work and unaccepted proposals are reused; failed/discarded work can retry.
module SummaryGeneration
  class StartGenerationService < ApplicationService
    def initialize(user:, target_kind:, target_id: nil)
      @user, @kind, @id = user, target_kind, target_id
    end

    def call
      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "generate_summary",
        resolve_existing: -> { existing }, prepare_task: ->(task) { prepare(task) })
    rescue ActiveRecord::RecordNotFound
      failure([ "Record not found" ])
    rescue ArgumentError => error
      failure([ error.message ])
    end

    private

    def existing
      @references = SourceReferences.capture(user: @user, target_kind: @kind, target_id: @id, lock_sources: true)
      latest = SourceReferences.latest(user: @user, target_kind: @kind, target_id: @references["target_id"])
      return unless latest && !latest.failed? && !latest.accepted? && !SourceReferences.stale?(user: @user, task: latest)
      success(latest)
    end

    def prepare(task)
      task.input = @references
      success(task)
    end
  end
end

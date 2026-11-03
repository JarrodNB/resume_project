# Saves an owner's decision to stop answering questions or hide one assessment.
# Dismissals belong to the exact completed result and source digest, so a new review starts fresh.
module CareerLibrary
  class DismissReviewService < ApplicationService
    def initialize(user:, review_task_id:, kind:, record_id:, scope:)
      @user, @task_id, @kind, @record_id, @scope = user, review_task_id, kind, record_id.to_s, scope
    end

    def call
      return failure([ "Choose questions or review to dismiss." ]) unless %w[questions review].include?(@scope)

      @user.with_lock do
        task = @user.ai_tasks.find(@task_id)
        unless task.completed? && (task.review_library_section? || task.improve_library_entry? && task.accepted?)
          next failure([ "Choose a completed review." ])
        end
        snapshot = EditCommand.capture(user: @user, kind: @kind, record_id: @record_id)
        item = if task.review_library_section?
          Array(task.result["assessments"]).find { |entry| entry["kind"] == @kind && entry["record_id"] == @record_id }
        else
          task.result["assessment"]
        end
        target = snapshot.fetch("target")
        unless item && ReviewSources.target_key(item) == ReviewSources.target_key(target) && item["source_digest"] == target["source_digest"]
          next failure([ "This review is out of date. Review this section again." ])
        end
        key = ReviewSources.target_key(item).join(":")
        state = ReviewStateService.call(user: @user, section: snapshot.fetch("section")).value
        current = state[:assessments].find { |entry| ReviewSources.target_key(entry) == ReviewSources.target_key(item) }
        dismissals = task.result.fetch("dismissed_assessments", {}).dup
        unless current ? current["review_task_id"] == task.id : dismissals.key?(key)
          next failure([ "This review is no longer current. Reload to see the latest feedback." ])
        end
        scope = dismissals.dig(key, "scope") == "review" ? "review" : @scope
        dismissals[key] = { "source_digest" => item["source_digest"], "scope" => scope }
        task.update!(result: task.result.merge("dismissed_assessments" => dismissals))
        success(task)
      end
    rescue ActiveRecord::RecordNotFound
      failure([ "Record not found" ])
    end
  end
end

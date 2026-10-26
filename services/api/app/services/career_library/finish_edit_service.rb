# Accepts exactly the server-owned proposal, or closes an exchange without changing
# the library. Single-highlight saves retain IDs and do not replace sibling bullets.
# Discarding unfinished work records its terminal outcome for the owner's notices.
module CareerLibrary
  class FinishEditService < ApplicationService
    def initialize(user:, ai_task_id:, discard: false)
      @user, @task_id, @discard = user, ai_task_id, discard
    end

    def call
      @user.with_lock do
        task = @user.ai_tasks.improve_library_entry.find(@task_id)
        next success(task) if @discard && EditSnapshot.discarded?(task)
        next success(task) if task.accepted?
        target = task.input.fetch("target")
        latest = EditSnapshot.latest(user: @user, kind: target["kind"], record_id: target["record_id"])
        next failure([ "A newer edit exists. Reload to continue." ]) unless latest&.id == task.id
        if @discard
          AiTasks::UpdateTaskService.call(task: task, attributes: { status: "failed", error_message: EditSnapshot::DISCARD_MESSAGE, pending_questions: [], completed_at: Time.current })
          next success(task)
        end
        next failure([ "Wait for a completed proposal before accepting." ]) unless task.completed? && ApplyEditService.valid_proposal?(task.result, target)

        record = EditSnapshot.owned_record(user: @user, kind: target["kind"], record_id: target["record_id"])
        context_record = target["kind"] == "experience_highlight" ? record.experience : record
        context_record.lock!
        record.lock! unless record == context_record
        task.lock!
        next failure([ "This entry changed. Start a new edit from its current text." ]) if EditSnapshot.stale?(user: @user, task: task)

        field = target.fetch("field")
        record[field] = task.result.fetch("text")
        # This covers exact generated text, not a claimed classifier result. Ordinary
        # user edits already remove changed fields from this reusable coverage list.
        record.screened_fields |= [ field ]
        record.save!
        current = EditSnapshot.capture(user: @user, kind: target["kind"], record_id: target["record_id"])
        assessment = current.fetch("target").except("label").merge(task.result.slice("color", "reason"))
        task.update!(accepted_at: Time.current, result: task.result.merge("assessment" => assessment))
        SyncLibraryEmbeddingsJob.perform_later(@user.id) unless target["kind"] == "user"
        success(task)
      end
    rescue ActiveRecord::RecordNotFound
      failure([ "Record not found" ])
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end
  end
end

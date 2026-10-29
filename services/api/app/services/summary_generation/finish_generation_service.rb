# Accepts a completed owned proposal only while its evidence and empty destination are
# current. Discard closes work durably. User-edited text does not inherit generated trust.
module SummaryGeneration
  class FinishGenerationService < ApplicationService
    DISCARD_MESSAGE = "Summary draft discarded.".freeze

    def initialize(user:, ai_task_id:, text: nil, discard: false)
      @user, @task_id, @text, @discard = user, ai_task_id, text, discard
    end

    def call
      @user.with_lock do
        task = @user.ai_tasks.generate_summary.find(@task_id)
        next success(task) if task.accepted? || (@discard && task.error_message == DISCARD_MESSAGE)
        latest = Snapshot.latest(user: @user, target_kind: task.input["target_kind"], target_id: task.input["target_id"])
        next failure([ "A newer summary draft exists. Reload to continue." ]) unless latest&.id == task.id
        target = task.input["target_kind"] == "resume" ? @user.resumes.lock.find(task.input["target_id"]) : @user
        if @discard
          task.lock!
          AiTasks::UpdateTaskService.call(task: task, attributes: { status: "failed", error_message: DISCARD_MESSAGE, completed_at: Time.current })
          next success(task)
        end
        next failure([ "Wait for a completed summary before accepting." ]) unless task.completed? && ValidateResultService.call(ai_task: task, result: task.result).success?
        next failure([ "Your career information changed. Generate a new summary." ]) if Snapshot.stale?(user: @user, task: task, lock_sources: true)
        task.lock!
        text = @text.nil? ? task.result.fetch("text") : @text.to_s.strip
        next failure([ "Enter a summary within #{TextLimits::PROSE} characters." ]) if text.blank? || text.length > TextLimits::PROSE
        if target.is_a?(Resume)
          save_resume_summary(target, text)
        else
          @user.summary = text
          @user.screened_fields = @user.screened_fields - [ "summary" ]
          @user.screened_fields |= [ "summary" ] if text == task.result.fetch("text")
          @user.save!
        end
        task.update!(accepted_at: Time.current)
        success(task)
      end
    rescue ActiveRecord::RecordNotFound
      failure([ "Record not found" ])
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # Reuse a blank summary section; otherwise insert after contact without losing order.
    # The owner and resume are locked before this is called, so concurrent accept/edit/delete
    # cannot interleave or create a second summary. Inclusion belongs to the resume, not text.
    def save_resume_summary(resume, text)
      sections = resume.sections.reorder(:position, :id).to_a
      summary = sections.find(&:summary?)
      if summary
        summary.update!(content: { "text" => text })
      else
        insertion = sections.rindex(&:contact?)
        insertion = insertion ? insertion + 1 : 0
        summary = resume.sections.build(section_type: "summary", title: "Summary", content: { "text" => text }, position: insertion)
        sections.insert(insertion, summary)
        sections.each_with_index { |section, position| section.update!(position: position) }
      end
    end
  end
end

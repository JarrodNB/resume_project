# Saves a completed Markdown draft once. Acceptance stays recorded after deletion.
# The owner lock serializes saves with new tailoring starts; the task lock keeps acceptance
# atomic. Deleting the job later keeps these saved snapshots.
module ResumeTailoring
  class SaveTailoredResumeService < ApplicationService
    NOT_READY_MESSAGE = "Finish the resume before saving it.".freeze
    ALREADY_SAVED_MESSAGE = "This resume has already been saved.".freeze

    def initialize(ai_task:, markdown: nil)
      @ai_task = ai_task
      @markdown = markdown
    end

    # Saves once. A second call returns an error without creating another resume.
    def call
      return failure([ NOT_READY_MESSAGE ]) unless @ai_task.tailor_resume? && @ai_task.completed?

      return failure([ "This job no longer exists." ]) unless @ai_task.subject.is_a?(Job)

      @ai_task.user.with_lock do
        @ai_task.with_lock do
          return failure([ ALREADY_SAVED_MESSAGE ]) if @ai_task.accepted? || @ai_task.user.resumes.exists?(job_id: @ai_task.subject_id)

          result = @ai_task.result
          return failure([ NOT_READY_MESSAGE ]) unless result.is_a?(Hash) && result["markdown"].is_a?(String)
          return failure([ NOT_READY_MESSAGE ]) unless [ 1, 2 ].include?(result["target_pages"])

          resume = create_resume(@markdown.nil? ? result["markdown"] : @markdown, result["target_pages"])
          @ai_task.update!(accepted_at: Time.current)
          success(resume)
        end
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # One document, with the user's edits and the requested page target.
    def create_resume(markdown, target_pages)
      job = @ai_task.subject
      title = job ? "#{job.title} at #{job.company.presence || 'Unknown company'}" : "Tailored resume"
      @ai_task.user.resumes.create!(job: job, title: title, markdown: markdown, target_pages: target_pages)
    end
  end
end

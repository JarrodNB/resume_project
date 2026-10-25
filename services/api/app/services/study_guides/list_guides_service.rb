# Pages through one owned job's successful guide summaries without loading generated bodies.
# Signed job-bound keyset cursors remain stable when newer guides are added.
module StudyGuides
  class ListGuidesService < ApplicationService
    PAGE_SIZE = 5

    def initialize(job:, user:, cursor: nil)
      @job, @user, @cursor = job, user, cursor
    end

    def call
      guides = @job.ai_tasks.where(user_id: @user.id, task_type: "generate_study_guide", status: "completed")
      if @cursor.present?
        position = verifier.verified(@cursor, purpose: "study-guide-history")
        return failure([ "Invalid guide history cursor. Reload the job to try again." ]) unless position.is_a?(Hash) && position["job_id"] == @job.id
        guides = guides.where("(created_at, id) < (?, ?)", Time.iso8601(position.fetch("created_at")), position.fetch("id"))
      end
      rows = guides.select(:id, :created_at).order(created_at: :desc, id: :desc).limit(PAGE_SIZE + 1).to_a
      page = rows.first(PAGE_SIZE)
      next_cursor = if rows.size > PAGE_SIZE
        last = page.last
        verifier.generate({ "job_id" => @job.id, "created_at" => last.created_at.iso8601(6), "id" => last.id }, purpose: "study-guide-history")
      end
      success(guides: page, next_cursor: next_cursor, errors: [])
    rescue ArgumentError, KeyError
      failure([ "Invalid guide history cursor. Reload the job to try again." ])
    end

    private

    def verifier
      Rails.application.message_verifier("study-guide-history")
    end
  end
end

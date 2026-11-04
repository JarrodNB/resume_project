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
      guides = guides.select(:id, :created_at, Arel.sql("input->>'description' AS source_description"),
        Arel.sql("result->>'source_description_fingerprint' AS source_fingerprint"))
      result = Pagination::ReadCreatedPageService.call(records: guides, cursor: @cursor,
        binding: { "job_id" => @job.id }, purpose: "study-guide-history", limit: PAGE_SIZE)
      return failure([ "Invalid guide history cursor. Reload the job to try again." ]) unless result.success?

      summaries = result.value[:records].map do |guide|
        source_fingerprint = DescriptionFingerprint.from_values(guide[:source_fingerprint], guide[:source_description])
        { id: guide.id, created_at: guide.created_at,
          source_description_fingerprint: source_fingerprint,
          out_of_date: source_fingerprint != DescriptionFingerprint.fingerprint(@job.description) }
      end
      success(guides: summaries, next_cursor: result.value[:next_cursor], errors: [])
    end
  end
end

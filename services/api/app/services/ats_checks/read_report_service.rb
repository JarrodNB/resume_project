# Present freshness separately for content, job alignment, and the later exported PDF.
module AtsChecks
  class ReadReportService < ApplicationService
    def initialize(resume:, run: nil)
      @resume, @run = resume, run
    end

    def call
      run = @run || @resume.ats_check_runs.order(created_at: :desc, id: :desc).first
      return success(nil) unless run
      content_changed = Snapshot.fingerprint(Snapshot.content(@resume)) != run.content_fingerprint ||
                        run.rubric_version != Snapshot::RUBRIC_VERSION
      job = Snapshot.job(@resume)
      job_changed = Snapshot.fingerprint(job) != run.job_fingerprint
      state = run.ai_task&.failed? ? "failed" : run.status
      state = "queued" if state == "pending"
      reason = run.error_message.presence || run.ai_task&.error_message
      alignment = run.content_result["job_alignment"] || { "status" => state, "reason" => reason }
      quality = run.content_result["content_quality"] || { "status" => state, "reason" => reason }
      alignment = alignment.merge("status" => "outdated", "score" => nil) if content_changed || job_changed
      alignment = { "status" => "unavailable", "reason" => "No usable job requirements.", "assessments" => [] } if job["requirements"].empty?
      quality = quality.merge("status" => "outdated", "score" => nil) if content_changed
      pdf = run.pdf_result.presence || { "status" => "awaiting_export", "reason" => "Export the saved resume to check its PDF." }
      pdf = pdf.merge("status" => "outdated", "score" => nil) if content_changed && run.pdf_result.present?
      categories = [ alignment, quality, pdf ].reject { |c| c["status"] == "unavailable" }
      overall = if categories.any? && categories.all? { |c| c["status"] == "completed" && c["score"].is_a?(Numeric) }
        (categories.sum { |c| c["score"] }.to_f / categories.size).round
      end
      success({ id: run.id, run_id: run.id, content_fingerprint: run.content_fingerprint,
                job_fingerprint: run.job_fingerprint, rubric_version: run.rubric_version,
                outdated: content_changed || job_changed, ai_task: run.ai_task,
                created_at: run.created_at, job_alignment: alignment, content_quality: quality,
                pdf_readability: pdf, overall_score: overall })
    end
  end
end

# Remembers checked fields only for the task's owned job and exact current values.
# Python reports canonical typed-value fingerprints, so late results cannot approve edits.
require "digest"
require "json"

module Jobs
  class RecordScreeningService < ApplicationService
    FIELDS = Screening::RecordApprovalsService::RECORD_TYPES.fetch("job")[:fields]

    # Call after assigning edits under the job row lock, before saving.
    def self.discard_changed_fields(job:)
      job.discard_changed_screened_fields
    end

    # Matches Python JSON encoding without Rails HTML escaping or whitespace.
    def self.field_fingerprint(value)
      Digest::SHA256.hexdigest(JSON.generate(value))
    end

    def initialize(ai_task:, reports:)
      @task, @reports = ai_task, reports
    end

    # @return [ServiceResult] ignores unknown, foreign, deleted and stale reports.
    def call
      return success(nil) unless @reports.is_a?(Array) && @reports.any?
      return success(nil) unless @task.subject_type == "Job" && %w[analyze_gaps tailor_resume].include?(@task.task_type)

      job = @task.user.jobs.find_by(id: @task.subject_id)
      return success(nil) unless job

      job.with_lock do
        fields = Array(@reports).flat_map do |report|
          next [] unless report.is_a?(Hash) && report["job_id"] == job.id && report["fields"].is_a?(Hash)

          report["fields"].filter_map do |field, fingerprint|
            next unless FIELDS.include?(field) && fingerprint.is_a?(String) && fingerprint.match?(/\A[0-9a-f]{64}\z/)
            field if fingerprint == self.class.field_fingerprint(job[field])
          end
        end
        combined = job.screened_fields | fields
        job.update!(screened_fields: combined) if combined != job.screened_fields
      end
      success(nil)
    rescue ActiveRecord::RecordNotFound
      success(nil)
    end
  end
end

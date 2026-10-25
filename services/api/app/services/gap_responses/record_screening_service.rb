# Persist checked answer fields only for the task's owned, snapshotted records.
# Exact value fingerprints under row locks prevent delayed results from approving edits.
require "digest"
require "json"

module GapResponses
  class RecordScreeningService < ApplicationService
    FIELDS = %w[requirement body].freeze

    # Assign edits under the response row lock, then clear only changed checks before save.
    def self.discard_changed_fields(response:)
      response.screened_fields -= response.changed & FIELDS
    end

    # Match Python's UTF-8 JSON without Rails HTML escaping.
    def self.field_fingerprint(value)
      Digest::SHA256.hexdigest(JSON.generate(value))
    end

    def initialize(ai_task:, reports:)
      @task, @reports = ai_task, reports
    end

    # @return [ServiceResult] ignores unrelated, malformed, deleted and stale reports.
    def call
      return success(nil) unless @reports.is_a?(Array) && @reports.any?
      return success(nil) unless @task.task_type == "tailor_resume" && @task.subject_type == "Job"

      job = @task.user.jobs.find_by(id: @task.subject_id)
      return success(nil) unless job

      snapshots = Array(@task.input["gap_responses"]).select { |item| item.is_a?(Hash) && item["id"].is_a?(String) }
      @reports.select { |item| item.is_a?(Hash) && item["response_id"].is_a?(String) }
        .group_by { |item| item["response_id"] }.sort.each do |id, reports|
        snapshot = snapshots.find { |item| item["id"] == id }
        next unless snapshot

        response = job.gap_responses.find_by(id: id)
        next unless response

        record_fields(response, snapshot, reports)
      end
      success(nil)
    end

    private

    def record_fields(response, snapshot, reports)
      response.with_lock do
        fields = reports.flat_map do |report|
          next [] unless report["fields"].is_a?(Hash)

          report["fields"].filter_map do |field, fingerprint|
            next unless FIELDS.include?(field) && snapshot[field].is_a?(String) && fingerprint.is_a?(String) && fingerprint.match?(/\A[0-9a-f]{64}\z/)
            next unless fingerprint == self.class.field_fingerprint(snapshot[field])

            field if fingerprint == self.class.field_fingerprint(response[field])
          end
        end
        combined = response.screened_fields | fields
        response.update!(screened_fields: combined) if combined != response.screened_fields
      end
    rescue ActiveRecord::RecordNotFound
      # An answer deleted after lookup cannot receive an approval.
      nil
    end
  end
end

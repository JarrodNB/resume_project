# Saves successful checks independently of task outcomes and accounting.
# Invalid batches are discarded entirely so redelivery cannot create partial approvals or
# prevent an otherwise valid task result and its billed usage from being applied.
module AiTasks
  class RecordScreeningSuccessesService < ApplicationService
    MAX_REPORTS = 1000
    FIELDS = %w[content_digest policy_identity].freeze
    DIGEST = /\A[0-9a-f]{64}\z/

    # @param ai_task [AiTask] trusted task whose owner receives these checks
    # @param reports [Object] untrusted optional queue metadata; no source text is accepted
    def initialize(ai_task:, reports:)
      @ai_task = ai_task
      @reports = reports
    end

    def call
      return failure([ "Invalid screening success metadata" ]) unless valid_reports?
      return success(false) if @reports.empty?

      rows = @reports.map { |report| report.merge("user_id" => @ai_task.user_id, "created_at" => Time.current) }
      ScreeningDecision.insert_all(rows, unique_by: :unique_screening_decision)
      success(true)
    end

    private

    def valid_reports?
      @reports.is_a?(Array) && @reports.size <= MAX_REPORTS && @reports.all? do |report|
        report.is_a?(Hash) && report.keys.size == FIELDS.size && (report.keys - FIELDS).empty? && FIELDS.all? do |field|
          report[field].is_a?(String) && DIGEST.match?(report[field])
        end
      end
    end
  end
end

# Saves completed checks from the worker only for unchanged sources owned by its task.
# Bad optional entries are ignored so task outcomes and accounting can still be recorded.
# The result consumer calls this without a transaction: each atomic stamp commits before
# the next source is touched, avoiding retained source locks during concurrent library edits.
module RecordScreening
  class ApplySuccessesService < ApplicationService
    UUID = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i
    ASSOCIATIONS = {
      "Job" => :jobs, "Experience" => :experiences, "Project" => :projects,
      "Education" => :educations, "Certification" => :certifications,
      "Skill" => :skills, "LibraryFact" => :library_facts
    }.freeze

    def initialize(ai_task:, reports:)
      @user, @reports = ai_task.user, reports
    end

    # Atomically compares the observed content timestamp; stamping never changes that version.
    def call
      return success(nil) unless @reports.is_a?(Array)

      @reports.each do |report|
        next unless valid_report?(report)

        observed = parse_timestamp(report["observed_updated_at"])
        next unless observed

        scope = owned_scope(report["record_type"])
        next unless scope

        # Ordered associations turn UPDATE into an id subquery whose version filter
        # can use a stale snapshot after waiting on an editor. Keep the timestamp
        # predicate on the updated row so PostgreSQL rechecks it after lock waits.
        scope.reorder(nil).where(id: report["record_id"], updated_at: observed).update_all(
          screened_at: Time.current, screening_policy_version: report["screening_policy_version"]
        )
      end
      success(nil)
    end

    private

    def valid_report?(report)
      return false unless report.is_a?(Hash)

      id, policy, timestamp = report.values_at("record_id", "screening_policy_version", "observed_updated_at")
      id.is_a?(String) && UUID.match?(id) && policy.is_a?(String) && policy.present? &&
        policy.length <= 255 && !policy.include?("\u0000") && timestamp.is_a?(String) && timestamp.length <= 40
    end

    def parse_timestamp(value)
      Time.iso8601(value) if !value.start_with?("0000") && value.match?(/\A\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})\z/)
    rescue ArgumentError
      nil
    end

    def owned_scope(type)
      return @user.public_send(ASSOCIATIONS.fetch(type)) if ASSOCIATIONS.key?(type)

      case type
      when "User" then User.where(id: @user.id)
      when "JobGapResponse" then JobGapResponse.where(job_id: @user.jobs.select(:id))
      when "InterviewQuestion" then InterviewQuestion.where(interview_question_set_id: @user.interview_question_sets.select(:id))
      end
    end
  end
end

# Clears a saved source's check when its screened content changes. Call after assigning
# content and before saving, inside the same transaction as any child changes.
module RecordScreening
  class InvalidateService < ApplicationService
    CONTENT_FIELDS = {
      "User" => %w[summary],
      "Job" => %w[title company location url description requirements responsibilities nice_to_haves notes],
      "Experience" => %w[company title location description start_date end_date],
      "Project" => %w[name role url description start_date end_date],
      "Education" => %w[institution degree field_of_study description start_date end_date],
      "Certification" => %w[name issuer issued_date expiry_date issued_date_precision expiry_date_precision credential_id credential_url description],
      "Skill" => %w[name category],
      "LibraryFact" => %w[requirement response],
      "JobGapResponse" => %w[requirement body],
      "InterviewQuestion" => %w[question_text answer_text]
    }.freeze

    # @param content_changed [Boolean] whether child content changed without parent attributes
    def initialize(record:, content_changed: false)
      @record, @content_changed = record, content_changed
    end

    # Prepares guaranteed state clearing with the next save, including stale loaded records.
    def call
      return success(@record) unless @content_changed || CONTENT_FIELDS.fetch(@record.class.name).any? { |field| @record.will_save_change_to_attribute?(field) }

      @record.screened_at = nil
      @record.screening_policy_version = nil
      # A result may have set these columns since this instance was loaded as unchecked.
      @record.screened_at_will_change!
      @record.screening_policy_version_will_change!
      # PostgreSQL persists microseconds. Even a frozen or backward clock must give
      # edited content a different version from the source that was screened.
      @record.updated_at = [ Time.current, @record.updated_at && @record.updated_at + Rational(1, 1_000_000) ].compact.max
      success(@record)
    end
  end
end

# Remembers reusable coverage of saved career-library fields and forgets it on user edits.
# Ordinary reports represent successful classifier checks; AI edit acceptance also covers
# the exact server-owned generated field without classifying it. No screening happens here.
# Every reported field needs a fingerprint of the value that was checked, so a late result
# cannot approve text the user edited after the task was queued.
module CareerLibrary
  class RecordScreeningService < ApplicationService
    FIELDS = Screening::RecordApprovalsService::LIBRARY_TYPES.to_h do |record_type|
      entry = Screening::RecordApprovalsService::RECORD_TYPES.fetch(record_type)
      [ entry[:model].name, entry[:fields] ]
    end.freeze

    # Call under the record row lock after assigning edits and before saving.
    # Reload before assignment so concurrent approvals of old text are invalidated.
    # Raises KeyError for a model that is not part of the career library.
    def self.discard_changed_fields(record:)
      FIELDS.fetch(record.class.name)
      record.discard_changed_screened_fields
    end

    def initialize(user:, reports:)
      @user = user
      @reports = reports
    end

    # Adds successful checks once, ignoring unknown kinds, fields, records and fields
    # whose fingerprint does not match the saved value.
    def call
      Array(@reports).each do |report|
        next unless report.is_a?(Hash) && report["fingerprints"].is_a?(Hash)

        model_name = report["record_type"].to_s.camelize
        allowed = FIELDS[model_name]
        next unless allowed

        fields = Array(report["fields"]) & allowed
        next if fields.empty?

        record = owned_records(model_name).find_by(id: report["record_id"])
        next unless record

        record.with_lock do
          fingerprints = report["fingerprints"]
          checked_fields = fields.select do |field|
            fingerprints[field] == Screening::RecordApprovalsService.field_fingerprint(record[field])
          end
          combined = record.screened_fields | checked_fields
          record.update!(screened_fields: combined) if combined != record.screened_fields
        end
      end
      success(nil)
    end

    private

    def owned_records(model_name)
      return User.where(id: @user.id) if model_name == "User"
      return ExperienceHighlight.joins(:experience).where(experiences: { user_id: @user.id }) if model_name == "ExperienceHighlight"

      @user.public_send(model_name.underscore.pluralize)
    end
  end
end

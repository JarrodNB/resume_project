# Remembers successful checks of saved career-library fields and forgets fields when edited.
# Reports can only approve allowed fields belonging to the task owner. No screening happens here.
module CareerLibrary
  class RecordScreeningService < ApplicationService
    FIELDS = {
      "User" => %w[summary],
      "Experience" => %w[company title location description],
      "ExperienceHighlight" => %w[content],
      "Project" => %w[name role description],
      "Education" => %w[institution degree field_of_study description],
      "Certification" => %w[name issuer credential_id credential_url description],
      "Skill" => %w[name category],
      "LibraryFact" => %w[requirement response]
    }.freeze

    # Call after assigning edits and before saving; unchanged fields keep their checks.
    def self.discard_changed_fields(record:)
      changed = record.changed & FIELDS.fetch(record.class.name)
      record.screened_fields -= changed
    end

    def initialize(user:, reports:)
      @user = user
      @reports = reports
    end

    # Adds successful checks once, ignoring unknown kinds, fields, and records.
    def call
      Array(@reports).each do |report|
        next unless report.is_a?(Hash)

        model_name = report["record_type"].to_s.camelize
        allowed = FIELDS[model_name]
        next unless allowed

        fields = Array(report["fields"]) & allowed
        next if fields.empty?

        record = owned_records(model_name).find_by(id: report["record_id"])
        next unless record

        record.with_lock do
          combined = record.screened_fields | fields
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

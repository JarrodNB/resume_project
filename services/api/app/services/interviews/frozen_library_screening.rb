# Keeps approvals tied to frozen career text and typed job expectations, outside model prose.
# Snapshots may reuse a live approval only for the same owned career/job field and value.
module Interviews
  module FrozenLibraryScreening
    SOURCE_TYPES = {
      "profile" => "User", "experiences" => "Experience", "highlights" => "ExperienceHighlight",
      "projects" => "Project", "educations" => "Education", "certifications" => "Certification",
      "skills" => "Skill", "career_contexts" => "CareerContext"
    }.freeze

    # Record type names the shared screening recorder uses for each frozen source type.
    RECORD_TYPES = {
      "profile" => "user", "experiences" => "experience", "highlights" => "experience_highlight",
      "projects" => "project", "educations" => "education", "certifications" => "certification",
      "skills" => "skill", "career_contexts" => "career_context", "jobs" => "job"
    }.freeze

    def self.valid_source?(source)
      return false unless source.is_a?(Hash) && source["id"].is_a?(String) && source["text"].is_a?(String)
      return FrozenJobContext.valid_source?(source) if source["type"] == "jobs"

      model = source.is_a?(Hash) && SOURCE_TYPES[source["type"]]
      model && source["text"].is_a?(String) && source["id"].is_a?(String) &&
        CareerLibrary::RecordScreeningService::FIELDS.fetch(model).include?(source["field"])
    end

    def self.source_value(source)
      source["type"] == "jobs" ? source["value"] : source["text"]
    end

    # A shared-recorder receipt fingerprinting the frozen value, so only an unchanged live
    # value can be approved. Call only with a valid source.
    def self.approval_receipt(source)
      { "record_type" => RECORD_TYPES.fetch(source["type"]), "record_id" => source["id"],
        "fingerprints" => { source["field"] => Screening::RecordApprovalsService.field_fingerprint(source_value(source)) } }
    end

    def self.owned_record(user, source)
      return unless valid_source?(source)

      scope = case source["type"]
      when "profile" then User.where(id: user.id)
      when "highlights" then ExperienceHighlight.joins(:experience).where(experiences: { user_id: user.id })
      else user.public_send(source["type"])
      end
      scope.find_by(id: source["id"])
    end

    # Call while the interview's owner lock is held. Frozen true decisions survive
    # later edits/deletion, but live checks never approve a different frozen value.
    def self.hydrate(interview)
      context = interview.frozen_context.deep_dup
      return context unless context["sources"].is_a?(Array)

      context["sources"].each do |source|
        next unless source.is_a?(Hash)
        next if source["screened"] == true

        record = owned_record(interview.user, source)
        source["screened"] = !!(record && record[source["field"]] == source_value(source) &&
          record.screened_fields.include?(source["field"]))
      end
      context
    end
  end
end

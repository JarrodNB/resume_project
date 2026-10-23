# Keeps field approvals tied to frozen career text, separate from model-facing prose.
# Legacy snapshots may reuse a live approval only for the same owned field and value.
module Interviews
  module FrozenLibraryScreening
    SOURCE_TYPES = {
      "profile" => "User", "experiences" => "Experience", "highlights" => "ExperienceHighlight",
      "projects" => "Project", "educations" => "Education", "certifications" => "Certification",
      "skills" => "Skill", "library_facts" => "LibraryFact"
    }.freeze

    def self.valid_source?(source)
      model = source.is_a?(Hash) && SOURCE_TYPES[source["type"]]
      model && source["text"].is_a?(String) && source["id"].is_a?(String) &&
        CareerLibrary::RecordScreeningService::FIELDS.fetch(model).include?(source["field"])
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
        source["screened"] = !!(record && record[source["field"]] == source["text"] &&
          record.screened_fields.include?(source["field"]))
      end
      context
    end
  end
end

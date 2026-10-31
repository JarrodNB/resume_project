# Stores only the selected review identities and fingerprints. Source projections are
# temporary admission data; Python reads the owned section again for execution.
module CareerLibrary
  class ReviewCommand
    def self.from_projection(projection)
      library = projection.fetch("library")
      records = case projection.fetch("section")
      when "summary"
        [ [ "user", { "id" => library["summary_record_id"], "summary" => library["summary"] } ] ]
      when "experience"
        library.fetch("experiences").flat_map do |role|
          [ [ "experience", role ] ] + role.fetch("highlights").map { |item| [ "experience_highlight", item ] }
        end
      when "projects" then library.fetch("projects").map { |item| [ "project", item ] }
      when "career_contexts" then library.fetch("career_contexts").map { |item| [ "career_context", item ] }
      end
      fingerprints = records.map do |kind, record|
        fields = Screening::RecordApprovalsService::RECORD_TYPES.fetch(kind).fetch(:fields)
        { "record_type" => kind, "record_id" => record.fetch("id"),
          "fingerprints" => record.slice(*fields).transform_values { |value| Screening::RecordApprovalsService.field_fingerprint(value) } }
      end
      { "command_version" => 1, "section" => projection.fetch("section"),
        "targets" => projection.fetch("targets"), "field_fingerprints" => fingerprints }
    end
  end
end

# Builds a temporary selected-section projection for review admission and currentness.
# Reviews persist only identities and digests; legacy individual edits still use this helper
# until their separate migration. Context digests stale grades after edits or moved highlights.
module CareerLibrary
  class ReviewSnapshot
    SECTIONS = %w[experience summary projects career_contexts].freeze
    MAX_TARGETS = 250
    MAX_SOURCE_BYTES = 80_000

    def self.build(user:, section:, experience_id: nil, record_id: nil)
      raise ArgumentError, "Choose a supported library section" unless SECTIONS.include?(section)
      return narrative_snapshot(user: user, section: section, record_id: record_id) unless section == "experience"

      roles = user.experiences.includes(:highlights)
      roles = roles.where(id: experience_id) if experience_id
      experiences = roles.map do |role|
        role.attributes.slice("id", "company", "title", "location", "start_date", "end_date", "description", "screened_fields").merge(
          "highlights" => role.highlights.map { |item| item.attributes.slice("id", "content", "screened_fields") }
        )
      end
      targets = []
      experiences.each do |role|
        # Screening approvals are derived metadata; earning a check does not stale a grade.
        content = role.except("screened_fields").merge("highlights" => role["highlights"].map { |item| item.except("screened_fields") })
        digest = Digest::SHA256.hexdigest(content.to_json)
        if role["description"].present?
          targets << { "kind" => "experience", "record_id" => role["id"], "field" => "description", "source_digest" => digest }
        end
        role["highlights"].each do |item|
          targets << { "kind" => "experience_highlight", "record_id" => item["id"], "field" => "content", "source_digest" => digest }
        end
      end
      targets.each_with_index { |target, index| target["label"] = "T#{index + 1}" }
      { "section" => section, "library" => { "experiences" => experiences }, "targets" => targets }
    end

    # These cases intentionally allow only the narrative field in each supported section.
    def self.narrative_snapshot(user:, section:, record_id:)
      targets = []
      # Fresh relations avoid reusing associations loaded before a saved edit.
      library = case section
      when "summary"
        user = User.find(user.id)
        source = { "id" => user.id, "summary" => user.summary }
        targets << narrative_target("user", source, "summary") if user.summary.present?
        { "summary_record_id" => user.id, "summary" => user.summary, "screened_fields" => user.screened_fields }
      when "projects"
        records = user.projects.where(nil)
        records = records.where(id: record_id) if record_id
        values = records.map { |record| record.attributes.slice("id", "name", "role", "start_date", "end_date", "description", "screened_fields") }
        values.each { |record| targets << narrative_target("project", record, "description") if record["description"].present? }
        { "projects" => values }
      when "career_contexts"
        records = user.career_contexts.where(nil)
        records = records.where(id: record_id) if record_id
        values = records.map { |record| record.attributes.slice("id", "requirement", "response", "screened_fields") }
        values.each { |record| targets << narrative_target("career_context", record, "response") }
        { "career_contexts" => values }
      end
      targets.each_with_index { |target, index| target["label"] = "T#{index + 1}" }
      { "section" => section, "library" => library, "targets" => targets }
    end

    def self.narrative_target(kind, record, field)
      { "kind" => kind, "record_id" => record.fetch("id"), "field" => field,
        "source_digest" => Digest::SHA256.hexdigest(record.except("screened_fields").to_json) }
    end

    def self.target_key(target)
      target.values_at("kind", "record_id", "field")
    end
  end
end

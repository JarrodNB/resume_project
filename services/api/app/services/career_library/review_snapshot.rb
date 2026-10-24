# Captures only the selected section for an AI review. Digests tie each grade to its role
# context, so edits or moving a highlight cannot leave an old grade looking current.
module CareerLibrary
  class ReviewSnapshot
    MAX_TARGETS = 250
    MAX_SOURCE_BYTES = 80_000

    def self.build(user:, section:, experience_id: nil)
      raise ArgumentError, "Choose a supported library section" unless section == "experience"

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

    def self.target_key(target)
      target.values_at("kind", "record_id", "field")
    end
  end
end

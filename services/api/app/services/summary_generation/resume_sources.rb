# Selects owned saved-resume fields only long enough to fingerprint them.
# The command keeps section identities and hashes; Python reads the actual evidence.
module SummaryGeneration
  class ResumeSources
    FIELDS = {
      "experience" => %w[company title location start_date end_date description],
      "projects" => %w[name role start_date end_date description],
      "education" => %w[institution degree field_of_study start_date end_date description],
      "certifications" => %w[name issuer issued_date expiry_date description],
      "skills" => %w[name category]
    }.freeze

    def self.capture(user:, target_id:, lock_sources:)
      resume = user.resumes.find(target_id)
      resume.lock! if lock_sources
      sections = resume.sections.reorder(:position, :id)
      sections = sections.lock if lock_sources
      sections = sections.to_a
      if sections.any? { |section| section.summary? && section.content.is_a?(Hash) && section.content["text"].to_s.strip.present? }
        raise ArgumentError, "A summary already exists. Edit or improve it instead."
      end
      sources = []
      sections.each_with_index do |section, index|
        fields = FIELDS[section.section_type]
        next unless fields && section.content.is_a?(Hash) && section.content["items"].is_a?(Array)
        section.content["items"].each_with_index do |item, item_index|
          next unless item.is_a?(Hash)
          prefix = "SECTION_#{index + 1}_ITEM_#{item_index + 1}"
          fields.each do |field|
            next unless item[field].is_a?(String) && item[field].strip.present?
            source = { "label" => "#{prefix}_#{field.upcase}", "text" => item[field], "section_id" => section.id }
            sources << source
          end
          next unless section.experience? && item["highlights"].is_a?(Array)
          item["highlights"].each_with_index do |text, position|
            next unless text.is_a?(String) && text.strip.present?
            source = { "label" => "#{prefix}_HIGHLIGHT_#{position + 1}", "text" => text, "section_id" => section.id }
            sources << source
          end
        end
      end
      SourceReferences.build(target_kind: "resume", target_id: resume.id, sources: sources)
    end
  end
end

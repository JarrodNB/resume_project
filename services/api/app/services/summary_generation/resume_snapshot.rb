# Selects evidence from one saved resume, independent of its library or deleted job.
# Only exact server-owned generated prose skips screening; copied and edited fields do not.
# Resume items are copies, not library rows, so their sources carry no record id. Here
# `screened` means "matches earlier accepted generated output", not "passed a screen":
# it lets the worker skip that text, and it must never be saved as a screening approval.
module SummaryGeneration
  class ResumeSnapshot
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
      candidates = []
      sections.each_with_index do |section, index|
        fields = FIELDS[section.section_type]
        next unless fields && section.content.is_a?(Hash) && section.content["items"].is_a?(Array)
        section.content["items"].each_with_index do |item, item_index|
          next unless item.is_a?(Hash)
          prefix = "SECTION_#{index + 1}_ITEM_#{item_index + 1}"
          fields.each do |field|
            next unless item[field].is_a?(String) && item[field].strip.present?
            source = { "label" => "#{prefix}_#{field.upcase}", "text" => item[field], "screened" => false }
            sources << source
            candidates << source if section.projects? && field == "description"
          end
          next unless section.experience? && item["highlights"].is_a?(Array)
          item["highlights"].each_with_index do |text, position|
            next unless text.is_a?(String) && text.strip.present?
            source = { "label" => "#{prefix}_HIGHLIGHT_#{position + 1}", "text" => text, "screened" => false }
            sources << source
            candidates << source
          end
        end
      end
      snapshot = Snapshot.build(target_kind: "resume", target_id: resume.id, sources: sources)
      generated = generated_values(user, candidates.map { |source| source["text"] })
      candidates.each { |source| source["screened"] = generated.include?(source["text"]) }
      snapshot
    end

    # The database returns only requested exact prose values, not full historical task bodies.
    # Education, credentials, identities and skills are copied by tailoring and never earn
    # generated trust merely because their snapshots occur in a completed task.
    def self.generated_values(user, values)
      return [] if values.empty?
      tasks = user.ai_tasks.tailor_resume.completed.where.not(accepted_at: nil).select(:result).to_sql
      sql = ApplicationRecord.sanitize_sql_array([<<~SQL, { values: values.uniq }])
        SELECT DISTINCT prose.value FROM (#{tasks}) accepted
        CROSS JOIN LATERAL jsonb_array_elements_text(
          jsonb_path_query_array(accepted.result, '$.sections[*] ? (@.section_type == "experience").content.items[*].highlights[*]') ||
          jsonb_path_query_array(accepted.result, '$.sections[*] ? (@.section_type == "projects").content.items[*].description')
        ) AS prose(value)
        WHERE prose.value IN (:values)
      SQL
      ApplicationRecord.connection.select_values(sql)
    end
  end
end

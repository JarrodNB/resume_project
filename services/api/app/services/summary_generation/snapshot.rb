# Freezes owned career facts for one missing-summary request. Inclusion preferences and
# screening metadata do not change the source digest; changed career facts do.
module SummaryGeneration
  class Snapshot
    MAX_INPUT_BYTES = 180_000
    MAX_SOURCES = 1000
    EMPTY_MESSAGE = "Add career experience, projects, education, certifications, or skills before generating a summary.".freeze
    FIELDS = {
      experiences: %w[company title location description], projects: %w[name role description],
      educations: %w[institution degree field_of_study description],
      certifications: %w[name issuer description], skills: %w[name category],
      career_contexts: %w[response]
    }.freeze

    def self.capture(user:, target_kind:, target_id: nil, lock_sources: false)
      return ResumeSnapshot.capture(user: user, target_id: target_id, lock_sources: lock_sources) if target_kind == "resume"
      raise ActiveRecord::RecordNotFound unless target_kind == "profile" && (target_id.nil? || target_id.to_s == user.id.to_s)
      user.reload
      raise ArgumentError, "A summary already exists. Edit or improve it instead." if user.summary.present?
      sources = []
      FIELDS.each do |association, fields|
        records = user.public_send(association).reorder(:id)
        records = records.lock if lock_sources
        records.each_with_index do |record, index|
          fields.each do |field|
            next unless record.has_attribute?(field) && record[field].present?
            sources << { "label" => "#{association.to_s.upcase}_#{index + 1}_#{field.upcase}",
              "text" => record[field].to_s, "screened" => Array(record.screened_fields).include?(field) }
          end
          next unless association == :experiences
          highlights = record.highlights.reorder(:id)
          highlights = highlights.lock if lock_sources
          highlights.each_with_index do |highlight, position|
            sources << { "label" => "EXPERIENCES_#{index + 1}_HIGHLIGHT_#{position + 1}",
              "text" => highlight.content, "screened" => Array(highlight.screened_fields).include?("content") }
          end
        end
      end
      build(target_kind: target_kind, target_id: user.id, sources: sources)
    end

    def self.build(target_kind:, target_id:, sources:)
      raise ArgumentError, EMPTY_MESSAGE if sources.empty?
      snapshot = { "target_kind" => target_kind, "target_id" => target_id, "sources" => sources,
        "source_digest" => Digest::SHA256.hexdigest(sources.map { |source| source.except("screened") }.to_json) }
      raise ArgumentError, "This career evidence is too large to summarize. Reduce its text and try again." if sources.length > MAX_SOURCES || snapshot.to_json.bytesize > MAX_INPUT_BYTES
      snapshot
    end

    def self.latest(user:, target_kind:, target_id:)
      user.ai_tasks.generate_summary.where("input ->> 'target_kind' = ? AND input ->> 'target_id' = ?", target_kind, target_id.to_s)
        .order(created_at: :desc, id: :desc).first
    end

    def self.stale?(user:, task:, lock_sources: false)
      current = capture(user: user, target_kind: task.input["target_kind"], target_id: task.input["target_id"], lock_sources: lock_sources)
      current["source_digest"] != task.input["source_digest"]
    rescue ActiveRecord::RecordNotFound, ArgumentError
      true
    end
  end
end

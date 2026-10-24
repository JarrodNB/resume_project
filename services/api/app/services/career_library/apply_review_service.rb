# Validates grades against the exact owned task snapshot. Model output may describe
# targets, but it cannot introduce target identities or write career facts.
module CareerLibrary
  class ApplyReviewService < ApplicationService
    # A queued snapshot may outlive edits. Reuse only checks of the exact field
    # value still saved, holding its row lock until the ordinary recorder finishes.
    def self.record_screening(ai_task:, reports:)
      roles = Array(ai_task.input.dig("library", "experiences"))
      sources = roles.map { |role| [ "experience", role ] } + roles.flat_map { |role| Array(role["highlights"]).map { |item| [ "experience_highlight", item ] } }
      Array(reports).each do |report|
        next unless report.is_a?(Hash)
        source = sources.find { |kind, item| kind == report["record_type"] && item["id"] == report["record_id"] }&.last
        next unless source
        record = if report["record_type"] == "experience"
          ai_task.user.experiences.find_by(id: source["id"])
        else
          ExperienceHighlight.joins(:experience).where(experiences: { user_id: ai_task.user_id }).find_by(id: source["id"])
        end
        next unless record
        record.with_lock do
          fields = Array(report["fields"]).select { |field| source.key?(field) && record.has_attribute?(field) && record[field] == source[field] }
          RecordScreeningService.call(user: ai_task.user, reports: [ report.merge("fields" => fields) ])
        end
      end
    end

    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      targets = Array(@task.input["targets"])
      items = @result.is_a?(Hash) ? @result["assessments"] : nil
      return failure([ "The review did not cover the requested entries. Please try again." ]) unless items.is_a?(Array) && items.length == targets.length

      expected = targets.index_by { |target| ReviewSnapshot.target_key(target) }
      seen = []
      valid = items.all? do |item|
        next false unless item.is_a?(Hash)
        key = ReviewSnapshot.target_key(item)
        target = expected[key]
        next false unless target && !seen.include?(key) && item["source_digest"] == target["source_digest"]
        seen << key
        %w[red yellow green].include?(item["color"]) && item["reason"].is_a?(String) && item["reason"].strip.present? && item["reason"].length <= 240
      end
      valid ? success(nil) : failure([ "The review returned invalid assessments. Please try again." ])
    end
  end
end

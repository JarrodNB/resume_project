# Validates grades and optional questions against the exact owned task snapshot. Output may describe
# targets, but it cannot introduce target identities or write career facts.
module CareerLibrary
  class ApplyReviewService < ApplicationService
    # Normalize saved scalar reviews and new question sets at the same seam that
    # validates queue results, so callers never reinterpret question identities.
    def self.questions_for(item)
      values = item.key?("questions") ? item["questions"] : item["question"].nil? ? [] : [ item["question"] ]
      return unless values.is_a?(Array) && values.length <= 3
      return unless values.all? { |value| value.is_a?(String) && value.strip.present? && value.length <= 500 }

      values = values.map(&:strip)
      keys = values.map { |value| value.squish.downcase(:fold) }
      return unless keys.uniq.length == keys.length
      if item.key?("questions") && item.key?("question")
        legacy = item["question"]
        return unless legacy.nil? ? values.empty? : legacy.is_a?(String) && legacy.length <= 500 && legacy.strip == values.first
      end
      values
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
        !self.class.questions_for(item).nil? && %w[red yellow green].include?(item["color"]) && item["reason"].is_a?(String) && item["reason"].strip.present? && item["reason"].length <= 240
      end
      valid ? success(nil) : failure([ "The review returned invalid assessments. Please try again." ])
    end
  end
end

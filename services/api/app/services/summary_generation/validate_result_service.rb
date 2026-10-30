# Rejects malformed or uncited proposals before they become reviewable. Labels can
# reference only the referenced sources; model output never selects a destination record.
module SummaryGeneration
  class ValidateResultService < ApplicationService
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      labels = @result.is_a?(Hash) && @result["source_labels"]
      text = @result.is_a?(Hash) && @result["text"]
      known = Array(@task.input["source_references"]).map { |source| source["label"] }
      valid = @task.input["command_version"] == 1 && text.is_a?(String) && text.strip.present? && text.length <= TextLimits::PROSE &&
        labels.is_a?(Array) && labels.any? && labels.all? { |label| label.is_a?(String) && known.include?(label) } && labels.uniq == labels
      valid ? success(nil) : failure([ "The AI returned an invalid summary. Try generating it again." ])
    end
  end
end

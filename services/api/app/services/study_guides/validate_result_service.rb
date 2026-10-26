# Rejects malformed learning material and late results for deleted jobs.
# Source snapshots stay on the task; generated output never changes a job description.
module StudyGuides
  class ValidateResultService < ApplicationService
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      job = @task.user.jobs.lock.find_by(id: @task.subject_id) if @task.subject_type == "Job"
      return failure([ "This job no longer exists." ]) unless job && @task.input["job_id"] == job.id && @task.input["description"].is_a?(String) && @task.input["description"].present?
      guide = @result["study_guide"] if @result.is_a?(Hash)
      return failure([ "The AI could not produce a valid study guide. Try again." ]) unless valid_guide?(guide)
      success(guide)
    end

    private

    def text?(value, limit)
      value.is_a?(String) && value.strip.present? && value.length <= limit
    end

    def list?(value)
      value.is_a?(Array) && value.size.between?(1, 5) && value.all? { |item| text?(item, 1_000) }
    end

    def valid_guide?(guide)
      guide.is_a?(Hash) && text?(guide["title"], 200) && guide["topics"].is_a?(Array) &&
        guide["topics"].size.between?(1, 8) && guide["topics"].all? do |topic|
          topic.is_a?(Hash) && text?(topic["title"], 200) && text?(topic["why_it_matters"], 1_000) &&
            text?(topic["explanation"], 4_000) && list?(topic["exercises"]) && list?(topic["self_check_questions"])
        end
    end
  end
end

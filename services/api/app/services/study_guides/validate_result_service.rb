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
      prompts = guide["questions"].map { |question| QuestionCollection.normalize(question["question"]) }
      previous = QuestionCollection.prompts(job: job, user: @task.user).map { |question| QuestionCollection.normalize(question) }
      if prompts.uniq.size != prompts.size || (prompts & previous).any?
        return failure([ "The AI returned repeated study questions. Your saved questions are unchanged; try generating again." ])
      end
      success(guide)
    end

    private

    def text?(value, limit)
      value.is_a?(String) && value.strip.present? && value.length <= limit
    end

    def valid_guide?(guide)
      guide.is_a?(Hash) && guide["version"] == 1 && text?(guide["title"], 200) && guide["questions"].is_a?(Array) &&
        guide["questions"].size == 5 && guide["questions"].all? do |question|
          question.is_a?(Hash) && text?(question["question"], 1_000) && text?(question["why_it_matters"], 1_000) &&
            text?(question["answer"], 6_000) && text?(question["example"], 3_000)
        end
    end
  end
end

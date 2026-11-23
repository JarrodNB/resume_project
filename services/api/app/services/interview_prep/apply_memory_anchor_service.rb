# Saves a generated recall cue only while its answer and previous cue are unchanged.
# Runs inside the shared owner/task transaction; duplicate results never reapply.
module InterviewPrep
  class ApplyMemoryAnchorService < ApplicationService
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      question = @task.subject
      input = @task.input
      valid_source = question.is_a?(InterviewQuestion) && !question.retired? &&
        question.interview_question_set.user_id == @task.user_id && input["source_version"] == 1 &&
        question.id == input["question_id"] && question.interview_question_set_id == input["question_set_id"] &&
        question.interview_question_set.set_type == input["set_type"] &&
        question.question_revision == input["question_revision"] && question.answer_revision == input["answer_revision"] &&
        Digest::SHA256.hexdigest(question.memory_anchor) == input["memory_anchor_sha256"] &&
        question.ai_tasks.where(task_type: "generate_interview_memory_anchor").order(created_at: :desc, id: :desc).first&.id == @task.id
      return failure([ "Your answer or memory anchor changed. Generate another anchor." ]) unless valid_source

      anchor = @result["memory_anchor"] if @result.is_a?(Hash)
      return failure([ "The AI couldn't produce a valid memory anchor. Try again." ]) unless anchor.is_a?(String) && anchor.strip.length.between?(1, 600)

      question.update!(memory_anchor: anchor.strip)
      success(question)
    end
  end
end

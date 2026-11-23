# Starts written practice work with owned references and revision fences.
# Source text stays on the saved question; feedback and anchor generation save typed answers before admission.
# Index:
#   - call: validates the request and queues an operation without replacing existing content
module InterviewPrep
  class StartQuestionTaskService < ApplicationService
    TASK_TYPES = %w[regenerate_interview_question review_interview_answer generate_interview_memory_anchor].freeze

    # Receives an authorized question, optional answer, and replacement confirmation.
    def initialize(user:, question:, task_type:, answer_text: nil, memory_anchor: nil, confirmed: false)
      @user, @question, @task_type = user, question, task_type
      @answer_text, @confirmed = answer_text, confirmed
      @memory_anchor = memory_anchor
    end

    # Feedback and anchor generation save the typed answer even if the later allowance or queue check fails.
    def call
      return failure([ "Unknown interview operation" ]) unless TASK_TYPES.include?(@task_type)
      if %w[review_interview_answer generate_interview_memory_anchor].include?(@task_type)
        if @answer_text.blank?
          return failure([ @task_type == "review_interview_answer" ? "Write an answer before asking for feedback." : "Write an answer before generating a memory anchor." ])
        end

        saved = SaveAnswerService.call(question: @question, answer_text: @answer_text, memory_anchor: @memory_anchor)
        return saved unless saved.success?

        @saved_revisions = [ @question.question_revision, @question.answer_revision ]
        @saved_anchor_sha256 = Digest::SHA256.hexdigest(@question.memory_anchor)
      end
      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: @task_type, subject: @question,
                                        prepare_task: method(:prepare_task))
    end

    private

    # Rechecks state under the owner lock before persisting reference commands.
    def prepare_task(task)
      @question.reload
      if @task_type == "regenerate_interview_question" && @question.interview_question_set.manual?
        return failure([ "Custom questions cannot be replaced." ])
      end
      if @question.ai_tasks.where(task_type: TASK_TYPES, status: "queued").exists?
        return failure([ "An AI operation is already running for this question." ])
      end
      if @task_type == "regenerate_interview_question" && @question.answer_text.present? && !@confirmed
        return failure([ "Confirm replacement of this question and its answer." ])
      end
      if %w[review_interview_answer generate_interview_memory_anchor].include?(@task_type) &&
         [ @question.question_revision, @question.answer_revision ] != @saved_revisions
        return failure([ @task_type == "review_interview_answer" ? "The answer changed. Request feedback again." : "The answer changed. Generate another anchor." ])
      end
      if @task_type == "generate_interview_memory_anchor" && Digest::SHA256.hexdigest(@question.memory_anchor) != @saved_anchor_sha256
        return failure([ "The memory anchor changed. Generate another anchor." ])
      end
      if @task_type == "review_interview_answer" && @question.ai_tasks
         .where(task_type: "review_interview_answer", status: "completed")
         .where("input ->> 'question_revision' = ? AND input ->> 'answer_revision' = ?",
           @question.question_revision.to_s, @question.answer_revision.to_s).exists?
        return failure([ "Feedback has already been requested for this answer version. Save a changed answer first." ])
      end
      task.input = {
        "source_version" => 1, "set_type" => @question.interview_question_set.set_type,
        "question_id" => @question.id, "question_set_id" => @question.interview_question_set_id,
        "question_revision" => @question.question_revision, "answer_revision" => @question.answer_revision
      }
      if @task_type == "regenerate_interview_question"
        task.input["peer_revisions"] = @question.interview_question_set.questions.where.not(id: @question.id)
          .to_h { |peer| [ peer.id, peer.question_revision ] }
      else
        task.input["normalized_answer_sha256"] = FeedbackOutdatedService.answer_fingerprint(@question.answer_text)
      end
      task.input["memory_anchor_sha256"] = Digest::SHA256.hexdigest(@question.memory_anchor) if @task_type == "generate_interview_memory_anchor"
      success(task)
    end
  end
end

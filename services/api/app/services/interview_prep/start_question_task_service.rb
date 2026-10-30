# Starts replacement with owned references and revision fences. Feedback retains its
# existing input contract until its separate migration.
# Index:
#   - call: validates the request and queues an operation without replacing existing content
module InterviewPrep
  class StartQuestionTaskService < ApplicationService
    TASK_TYPES = %w[regenerate_interview_question review_interview_answer].freeze

    # Receives an authorized question, optional feedback answer, and replacement confirmation.
    def initialize(user:, question:, task_type:, answer_text: nil, confirmed: false)
      @user, @question, @task_type = user, question, task_type
      @answer_text, @confirmed = answer_text, confirmed
    end

    # Feedback saves the typed answer even if the later allowance or queue check fails.
    def call
      return failure([ "Unknown interview operation" ]) unless TASK_TYPES.include?(@task_type)
      if @task_type == "review_interview_answer"
        return failure([ "Write an answer before asking for feedback." ]) if @answer_text.blank?

        saved = SaveAnswerService.call(question: @question, answer_text: @answer_text)
        return saved unless saved.success?

        @saved_revisions = [ @question.question_revision, @question.answer_revision ]
      end
      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: @task_type, subject: @question,
                                        prepare_task: method(:prepare_task))
    end

    private

    # Rechecks state under the owner lock before persisting reference commands.
    def prepare_task(task)
      @question.reload
      if @question.ai_tasks.where(task_type: TASK_TYPES, status: "queued").exists?
        return failure([ "An AI operation is already running for this question." ])
      end
      if @task_type == "regenerate_interview_question" && @question.answer_text.present? && !@confirmed
        return failure([ "Confirm replacement of this question and its answer." ])
      end
      if @task_type == "review_interview_answer" &&
         [ @question.question_revision, @question.answer_revision ] != @saved_revisions
        return failure([ "The answer changed. Request feedback again." ])
      end
      if @task_type == "review_interview_answer" && @question.ai_tasks
         .where(task_type: "review_interview_answer", status: "completed")
         .where("input ->> 'question_revision' = ? AND input ->> 'answer_revision' = ?",
           @question.question_revision.to_s, @question.answer_revision.to_s).exists?
        return failure([ "Feedback has already been requested for this answer version. Save a changed answer first." ])
      end
      task.input = {
        "set_type" => @question.interview_question_set.set_type,
        "question_id" => @question.id, "question_set_id" => @question.interview_question_set_id,
        "question_revision" => @question.question_revision, "answer_revision" => @question.answer_revision
      }
      if @task_type == "regenerate_interview_question"
        task.input["source_version"] = 1
        task.input["peer_revisions"] = @question.interview_question_set.questions.where.not(id: @question.id)
          .to_h { |peer| [peer.id, peer.question_revision] }
      else
        task.input.merge!("question_text" => @question.question_text, "answer_text" => @question.answer_text,
                          "screened_fields" => @question.screened_fields)
      end
      success(task)
    end
  end
end

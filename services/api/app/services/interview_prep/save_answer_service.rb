# Saves a typed practice answer and its private recall cue. Only answer edits change
# the answer revision; cue-only edits keep feedback, screening, and embeddings intact.
# Actual edits clear only answer screening coverage; the unchanged question keeps its checks.
# Index:
#   - call: validates and saves without changing feedback or career-library content
module InterviewPrep
  class SaveAnswerService < ApplicationService
    # Receives an authorized question and the exact user-written answer.
    def initialize(question:, answer_text:, memory_anchor: nil)
      @question = question
      @answer_text = answer_text
      @memory_anchor = memory_anchor
    end

    # Serializes saving with question task creation through the same owner lock.
    def call
      @question.interview_question_set.user.with_lock do
        @question.reload
        if @question.ai_tasks.where(task_type: "regenerate_interview_question", status: "queued").exists?
          next failure([ "Wait for question regeneration to finish before editing the answer." ])
        end
        changed = @question.answer_text != @answer_text
        anchor_changed = !@memory_anchor.nil? && @question.memory_anchor != @memory_anchor
        @question.memory_anchor = @memory_anchor unless @memory_anchor.nil?
        @question.answer_revision += 1 if changed
        @question.answer_text = @answer_text
        @question.discard_changed_screened_fields
        if @question.save
          @question.embedding&.destroy! if changed
          SyncQuestionEmbeddingJob.perform_later(@question.interview_question_set.user_id, @question.id) if @question.answer_text.present? && (changed || !anchor_changed)
          success(@question)
        else
          failure(@question.errors)
        end
      end
    end
  end
end

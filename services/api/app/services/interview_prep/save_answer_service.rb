# Saves independent practice drafts and their selection alongside a private recall cue.
# Active edits change coaching identity; only projected text changes clear screening and vectors.
# Actual edits clear only answer screening coverage; the unchanged question keeps its checks.
# Index:
#   - call: validates and saves without changing feedback or career-library content
module InterviewPrep
  class SaveAnswerService < ApplicationService
    # Receives an authorized question and the exact user-written answer.
    def initialize(question:, answer_text:, memory_anchor: nil, answer_format: nil, answer_drafts: nil)
      @question = question
      @answer_text = answer_text
      @memory_anchor = memory_anchor
      @answer_format, @answer_drafts = answer_format, answer_drafts
    end

    # Serializes saving with question task creation through the same owner lock.
    def call
      @question.interview_question_set.user.with_lock do
        @question.reload
        if @question.ai_tasks.where(task_type: "regenerate_interview_question", status: "queued").exists?
          next failure([ "Wait for question regeneration to finish before editing the answer." ])
        end
        next failure([ "Retired questions cannot be edited." ]) if @question.retired?
        format = @answer_format || "plain_text"
        drafts = if @answer_drafts.is_a?(Hash)
          AnswerFormats.drafts(@question).merge(@answer_drafts)
        elsif @answer_drafts.nil?
          AnswerFormats.drafts(@question).merge("plain_text" => { "text" => @answer_text })
        else
          @answer_drafts
        end
        unless AnswerFormats.valid?(format, drafts)
          next failure([ "Choose a supported answer format with valid, bounded draft fields." ])
        end
        text = AnswerFormats.render(format, drafts)
        changed = @question.answer_text != text
        format_changed = @question.answer_format != format
        active_changed = format_changed ||
          AnswerFormats.drafts(@question).fetch(format, {}) != drafts.fetch(format, {})
        inactive_only_changed = !active_changed && AnswerFormats.drafts(@question) != drafts
        @question.answer_format, @question.answer_drafts = format, drafts
        anchor_changed = !@memory_anchor.nil? && @question.memory_anchor != @memory_anchor
        @question.memory_anchor = @memory_anchor unless @memory_anchor.nil?
        @question.answer_revision += 1 if active_changed
        @question.answer_format_revision = @question.answer_revision if format_changed
        @question.answer_text = text
        @question.discard_changed_screened_fields
        if @question.save
          @question.embedding&.destroy! if changed
          @question.embedding&.update!(answer_revision: @question.answer_revision) if active_changed && !changed
          SyncQuestionEmbeddingJob.perform_later(@question.interview_question_set.user_id, @question.id) if @question.answer_text.present? && !inactive_only_changed && (changed || !anchor_changed)
          success(@question)
        else
          failure(@question.errors)
        end
      end
    end
  end
end

# Description: Applies interview question drafts inside the owner's and task's locked transaction.
# Index:
#   - call: validates task identity, revisions, draft shape, and distinctness before persistence
module InterviewPrep
  class ApplyQuestionsService < ApplicationService
    CATEGORIES_BY_TYPE = {
      "fit_motivation" => %w[background motivation goals working_preferences contribution].freeze,
      "behavioral" => %w[collaboration problem_solving adaptation initiative judgment].freeze,
      "hypothetical" => %w[prioritization ambiguity disagreement quality_risk accountability].freeze,
      "technical" => %w[work_overview tools_methods decisions_tradeoffs problem_solving improvement_quality].freeze,
      "knowledge" => %w[concepts mechanisms application reasoning limitations].freeze
    }.freeze
    STALE_MESSAGE = "These questions are out of date. Request generation again.".freeze
    INVALID_MESSAGE = "We couldn't save valid, distinct interview questions. Try again.".freeze

    # Receives the locked task and worker result; the caller holds the owner lock first.
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    # Atomically saves all slots or updates one slot, preserving existing content on failure.
    def call
      record = current_subject
      return failure([ STALE_MESSAGE ]) unless record

      drafts = validated_drafts
      return failure([ INVALID_MESSAGE ]) unless drafts

      if @task.generate_interview_questions?
        record.questions.transaction(requires_new: true) do
          drafts.each_with_index do |draft, index|
            record.questions.create!(position: index + 1, question_text: draft["question_text"])
          end
        end
      else
        excluded = record.interview_question_set.questions.pluck(:question_text)
        return failure([ INVALID_MESSAGE ]) if excluded.any? { |text| normalize(text) == normalize(drafts.first["question_text"]) }

        retained = retain_answered_copy(record)
        record.update!(question_text: drafts.first["question_text"],
                       question_revision: record.question_revision + 1,
                       screened_fields: [], answer_format_revision: 0, answer_format: "plain_text", answer_drafts: {}, answer_text: "", memory_anchor: "", answer_revision: record.answer_revision + 1,
                       feedback: {}, feedback_question_revision: nil, feedback_answer_revision: nil)
        record.embedding&.destroy! unless retained
      end
      success(record)
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # Resolves the saved set or question only while the fence says the task is current.
    def current_subject
      return if PracticeTaskFence.stale_reason(@task)

      @task.subject
    end

    # Keeps an answered question as a retired, slotless copy before its slot is replaced.
    # The copy keeps the same revisions, so its feedback stays current and its vector moves with it.
    def retain_answered_copy(record)
      return false unless ActiveAnswer.answered?(record)

      copy = record.interview_question_set.retired_questions.create!(
        retired_at: Time.current, position: nil, question_text: record.question_text,
        answer_format_revision: record.answer_format_revision, answer_format: record.answer_format, answer_drafts: ActiveAnswer.drafts(record),
        answer_text: record.answer_text, memory_anchor: record.memory_anchor, question_revision: record.question_revision,
        answer_revision: record.answer_revision, feedback: record.feedback,
        feedback_question_revision: record.feedback_question_revision,
        feedback_answer_revision: record.feedback_answer_revision, screened_fields: record.screened_fields)
      record.embedding&.update!(interview_question_id: copy.id)
      # Forget the moved vector so saving the slot cannot autosave it back.
      record.association(:embedding).reset
      true
    end

    # Rejects malformed worker data before creating any records.
    def validated_drafts
      return unless @result.is_a?(Hash) && @result["interview_questions"].is_a?(Hash)

      drafts = @result["interview_questions"]["questions"]
      count = @task.generate_interview_questions? ? 5 : 1
      categories = CATEGORIES_BY_TYPE[@task.input["set_type"]]
      return unless categories
      return unless drafts.is_a?(Array) && drafts.length == count
      return unless drafts.all? do |draft|
        draft.is_a?(Hash) && draft["question_text"].is_a?(String) &&
          draft["question_text"].strip.length.between?(10, 1000) &&
          normalize(draft["question_text"]).present? && categories.include?(draft["category"]) &&
          draft["evidence_quotes"].is_a?(Array) && draft["evidence_quotes"].any? &&
          draft["evidence_quotes"].all? { |quote| quote.is_a?(String) && quote.strip.present? }
      end
      return unless drafts.map { |draft| normalize(draft["question_text"]) }.uniq.length == count
      return if count == 5 && drafts.map { |draft| draft["category"] }.uniq.length != 5

      avoided = InterviewPreferences::AvoidedQuestions.snapshot(@task.user)
      avoided = avoided.map { |text| normalize(text) }
      return if drafts.any? { |draft| avoided.include?(normalize(draft["question_text"])) }

      drafts
    end

    # Mirrors Python's punctuation, casing, and spacing independent duplicate comparison.
    def normalize(text)
      text.downcase(:fold).scan(/[[:alnum:]_]+/).join(" ")
    end
  end
end

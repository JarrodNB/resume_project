# Description: Applies interview question drafts inside the owner's and task's locked transaction.
# Index:
#   - call: validates task identity, revisions, draft shape, and distinctness before persistence
module InterviewPrep
  class ApplyQuestionsService < ApplicationService
    CATEGORIES = %w[introduction collaboration problem_solving learning_adaptation initiative_judgment].freeze
    # Accept complete results still in flight from an older worker during deployment.
    LEGACY_GENERAL_CATEGORIES = %w[introduction strengths development goals behavioral].freeze
    TECHNICAL_CATEGORIES = %w[work_overview tools_methods decisions_tradeoffs problem_solving improvement_quality].freeze
    KNOWLEDGE_CATEGORIES = %w[concepts mechanisms application reasoning limitations].freeze
    CATEGORIES_BY_TYPE = { "general" => CATEGORIES, "technical" => TECHNICAL_CATEGORIES,
                           "knowledge" => KNOWLEDGE_CATEGORIES }.freeze
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

        record.update!(question_text: drafts.first["question_text"],
                       question_revision: record.question_revision + 1,
                       screened_fields: [], answer_text: "", answer_revision: record.answer_revision + 1,
                       feedback: {}, feedback_question_revision: nil, feedback_answer_revision: nil)
        record.embedding&.destroy!
      end
      success(record)
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # Resolves through the owner, subject, and queue snapshot; a deleted target is obsolete.
    def current_subject
      record = @task.subject
      return unless record
      return unless record.ai_tasks.order(created_at: :desc, id: :desc)
                          .where(task_type: @task.task_type).first&.id == @task.id

      if @task.generate_interview_questions?
        return unless record.is_a?(InterviewQuestionSet) && record.user_id == @task.user_id
        return unless record.id == @task.input["question_set_id"] && record.questions.empty?
      else
        return unless record.is_a?(InterviewQuestion)
        return unless record.interview_question_set.user_id == @task.user_id
        return unless record.id == @task.input["question_id"] &&
                      record.interview_question_set_id == @task.input["question_set_id"]
        return unless record.question_revision == @task.input["question_revision"] &&
                      record.answer_revision == @task.input["answer_revision"] &&
                      record.question_text == @task.input["question_text"]
        return unless record.interview_question_set.questions.count == 5
      end
      question_set = record.is_a?(InterviewQuestionSet) ? record : record.interview_question_set
      return unless question_set.set_type == @task.input.fetch("set_type", "general")

      record
    end

    # Rejects malformed worker data before creating any records.
    def validated_drafts
      return unless @result.is_a?(Hash) && @result["interview_questions"].is_a?(Hash)

      drafts = @result["interview_questions"]["questions"]
      count = @task.generate_interview_questions? ? 5 : 1
      categories = CATEGORIES_BY_TYPE[@task.input.fetch("set_type", "general")]
      return unless categories
      return unless drafts.is_a?(Array) && drafts.length == count
      if @task.input.fetch("set_type", "general") == "general"
        received_categories = drafts.filter_map { |draft| draft["category"] if draft.is_a?(Hash) }
        if received_categories.all? { |category| LEGACY_GENERAL_CATEGORIES.include?(category) }
          categories = LEGACY_GENERAL_CATEGORIES
        end
      end
      return unless drafts.all? do |draft|
        draft.is_a?(Hash) && draft["question_text"].is_a?(String) &&
          draft["question_text"].strip.length.between?(10, 1000) &&
          normalize(draft["question_text"]).present? && categories.include?(draft["category"]) &&
          draft["evidence_quotes"].is_a?(Array) && draft["evidence_quotes"].any? &&
          draft["evidence_quotes"].all? { |quote| quote.is_a?(String) && quote.strip.present? }
      end
      return unless drafts.map { |draft| normalize(draft["question_text"]) }.uniq.length == count
      return if count == 5 && drafts.map { |draft| draft["category"] }.uniq.length != 5

      avoided = Array(@task.input["avoided_questions"]).map { |text| normalize(text) }
      return if drafts.any? { |draft| avoided.include?(normalize(draft["question_text"])) }

      drafts
    end

    # Mirrors Python's punctuation, casing, and spacing independent duplicate comparison.
    def normalize(text)
      text.downcase(:fold).scan(/[[:alnum:]_]+/).join(" ")
    end
  end
end

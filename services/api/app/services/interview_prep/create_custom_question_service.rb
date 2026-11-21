# Save a candidate's question in the existing bank without invoking AI or embeddings.
module InterviewPrep
  class CreateCustomQuestionService < ApplicationService
    def initialize(user:, set_type:, question_text:, answer_text: "")
      @user, @set_type, @text, @answer = user, set_type, question_text, answer_text || ""
    end

    # Allocates the same private numbering as generation under the owner's lock.
    def call
      return failure([ "Unknown interview question set type" ]) unless InterviewQuestionSet::SET_TYPES.include?(@set_type)
      return failure([ "Write a question of 1 to 2,000 characters." ]) if @text.blank? || @text.length > 2000

      @user.with_lock do
        previous = @user.ai_tasks.where(task_type: "generate_interview_questions")
                        .maximum(Arel.sql("(input->>'set_number')::integer")).to_i
        number = [ previous, @user.interview_question_sets.maximum(:number).to_i ].max + 1
        set = @user.interview_question_sets.create!(number: number, set_type: @set_type, origin: "manual")
        set.questions.create!(position: 1, question_text: @text, answer_text: @answer,
                              answer_revision: @answer.present? ? 1 : 0)
        success(set)
      end
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end
  end
end

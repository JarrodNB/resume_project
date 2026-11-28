# Public interview output intentionally excludes execution claims, storage keys, and model history.
module Types
  class InterviewSessionQuestionType < Types::BaseObject
    field :id, ID, null: false
    field :content, String, null: false
    field :question_type, String, null: false
    field :position, Integer, null: false
    field :accepted_answer_count, Integer, null: false
    field :skipped, Boolean, null: false
    field :live_feedback, String, null: true,
      description: "The live interviewer's latest spoken feedback for this question, saved as text. Null for turn-based interviews."

    def skipped
      object.skipped_at.present?
    end
  end
end

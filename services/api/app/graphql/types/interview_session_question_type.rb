# Public interview output intentionally excludes execution claims, storage keys, and model history.
module Types
  class InterviewSessionQuestionType < Types::BaseObject
    field :id, ID, null: false
    field :content, String, null: false
    field :position, Integer, null: false
    field :accepted_answer_count, Integer, null: false
  end
end

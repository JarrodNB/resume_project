# One bounded page of a job's saved answered study questions.
module Types
  class StudyQuestionBatchPageType < Types::BaseObject
    field :batches, [ Types::StudyQuestionBatchType ], null: false
    field :end_cursor, String
    field :total_questions, Integer, null: false
    field :errors, [ String ], null: false
  end
end

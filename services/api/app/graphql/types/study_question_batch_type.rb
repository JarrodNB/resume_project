# A saved question batch with immutable source identity for freshness across loaded pages.
module Types
  class StudyQuestionBatchType < Types::BaseObject
    field :id, ID, null: false
    field :result, GraphQL::Types::JSON, null: false
    field :source_description_fingerprint, String
    field :out_of_date, Boolean, null: false
  end
end

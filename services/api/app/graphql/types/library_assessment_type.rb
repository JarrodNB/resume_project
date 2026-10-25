# A text-labeled grade, reason, and up to three enrichment questions for one narrative field.
module Types
  class LibraryAssessmentType < Types::BaseObject
    field :kind, String, null: false
    field :record_id, ID, null: false
    field :field, String, null: false
    field :color, String, null: false
    field :reason, String, null: false
    field :question, String, null: true
    field :questions, [ String ], null: false, description: "Up to three distinct questions in saved order; an empty list means no missing fact needs a question."
    field :review_task_id, ID, null: true, description: "The completed review that produced this assessment and question."
    field :stale, Boolean, null: false
  end
end

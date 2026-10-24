# A text-labeled traffic light for one saved narrative field.
module Types
  class LibraryAssessmentType < Types::BaseObject
    field :kind, String, null: false
    field :record_id, ID, null: false
    field :field, String, null: false
    field :color, String, null: false
    field :reason, String, null: false
    field :stale, Boolean, null: false
  end
end

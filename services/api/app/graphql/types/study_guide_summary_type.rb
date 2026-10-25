# A history entry identifies generated material without fetching its potentially long body.
module Types
  class StudyGuideSummaryType < Types::BaseObject
    field :id, ID, null: false
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
    field :source_description_fingerprint, String,
          description: "Opaque identity of the exact description used for this guide."
    field :out_of_date, Boolean, null: false,
          description: "Whether the guide's exact source differs from the current description."
  end
end

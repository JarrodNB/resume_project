# A history entry identifies generated material without fetching its potentially long body.
module Types
  class StudyGuideSummaryType < Types::BaseObject
    field :id, ID, null: false
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
  end
end

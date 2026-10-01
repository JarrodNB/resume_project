# frozen_string_literal: true

# Description: Career library role, with its ordered highlights.
module Types
  class ExperienceType < Types::BaseObject
    field :id, ID, null: false
    field :company, String, null: false
    field :title, String, null: false
    field :location, String
    field :start_date, GraphQL::Types::ISO8601Date
    field :end_date, GraphQL::Types::ISO8601Date, description: "Null for a current role."
    field :description, String
    field :position, Integer, null: false
    field :highlights, [ Types::ExperienceHighlightType ], null: false
  end
end

# frozen_string_literal: true

# Description: Career library education entry.
module Types
  class EducationType < Types::BaseObject
    field :id, ID, null: false
    field :institution, String, null: false
    field :degree, String
    field :field_of_study, String
    field :start_date, GraphQL::Types::ISO8601Date
    field :end_date, GraphQL::Types::ISO8601Date
    field :description, String
    field :position, Integer, null: false
  end
end

# frozen_string_literal: true

# Description: Career library project.
module Types
  class ProjectType < Types::BaseObject
    field :id, ID, null: false
    field :name, String, null: false
    field :role, String
    field :url, String
    field :description, String
    field :start_date, GraphQL::Types::ISO8601Date
    field :end_date, GraphQL::Types::ISO8601Date
    field :position, Integer, null: false
  end
end

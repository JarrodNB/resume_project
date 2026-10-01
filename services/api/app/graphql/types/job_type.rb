# frozen_string_literal: true

# Description: Structured job profile and its application stage.
module Types
  class JobType < Types::BaseObject
    field :id, ID, null: false
    field :title, String, null: false
    field :company, String, null: false
    field :location, String
    field :url, String
    field :description, String
    field :requirements, [ String ], null: false
    field :nice_to_haves, [ String ], null: false
    field :stage, Types::JobStageEnum, null: false
    field :applied_at, GraphQL::Types::ISO8601DateTime
    field :notes, String
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
  end
end

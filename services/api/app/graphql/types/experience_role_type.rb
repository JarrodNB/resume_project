# A title and its dates within one experience, in the order written by the user.
module Types
  class ExperienceRoleType < Types::BaseObject
    field :id, ID, null: false
    field :title, String, null: false
    field :start_date, GraphQL::Types::ISO8601Date
    field :end_date, GraphQL::Types::ISO8601Date
    field :description, String
    field :position, Integer, null: false
  end
end

# frozen_string_literal: true

# An employment entry with ordered titles and stable bullets. Flat title/date fields
# are derived only for a single role; grouped callers must read roles.
module Types
  class ExperienceType < Types::BaseObject
    field :id, ID, null: false
    field :company, String, null: false
    field :title, String, deprecation_reason: "Read roles; grouped entries have no single title."
    field :location, String
    field :start_date, GraphQL::Types::ISO8601Date, deprecation_reason: "Read roles for each title’s dates."
    field :end_date, GraphQL::Types::ISO8601Date, description: "Null for a current or unstated end date, or a grouped entry.", deprecation_reason: "Read roles for each title’s dates."
    field :description, String
    field :position, Integer, null: false
    field :roles, [ Types::ExperienceRoleType ], null: false
    field :highlights, [ Types::ExperienceHighlightType ], null: false
  end
end

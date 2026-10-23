# frozen_string_literal: true

# An employment entry with ordered titles and stable bullets. Flat title/date fields
# remain a compatibility projection while callers adopt roles.
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
    field :roles, [ Types::ExperienceRoleType ], null: false
    field :highlights, [ Types::ExperienceHighlightType ], null: false

    # Read canonical values when present; old flat-only records remain readable.
    def title
      object.roles.first&.title || object[:title]
    end

    def start_date
      role = object.roles.first
      role ? role.start_date : object[:start_date]
    end

    def end_date
      role = object.roles.first
      role ? role.end_date : object[:end_date]
    end
  end
end

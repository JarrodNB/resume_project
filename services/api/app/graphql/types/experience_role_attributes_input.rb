# One ordered role. Nested highlights bind to this role even before it has an ID.
module Types
  class ExperienceRoleAttributesInput < Types::BaseInputObject
    argument :id, ID, required: false
    argument :title, String, required: true
    argument :start_date, GraphQL::Types::ISO8601Date, required: false
    argument :end_date, GraphQL::Types::ISO8601Date, required: false
    argument :description, String, required: false
    argument :highlights, [ Types::ExperienceHighlightAttributesInput ], required: false
  end
end

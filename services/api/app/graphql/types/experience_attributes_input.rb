# frozen_string_literal: true

# Description: Editable experience fields. All optional so it serves both create and update
# (model validations enforce company and title).
module Types
  class ExperienceAttributesInput < Types::BaseInputObject
    argument :company, String, required: false
    argument :title, String, required: false
    argument :location, String, required: false
    argument :start_date, GraphQL::Types::ISO8601Date, required: false
    argument :end_date, GraphQL::Types::ISO8601Date, required: false
    argument :description, String, required: false
    argument :position, Integer, required: false
  end
end

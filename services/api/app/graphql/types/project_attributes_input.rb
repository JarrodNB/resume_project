# frozen_string_literal: true

# Description: Editable project fields. All optional so it serves both create and update
# (model validations enforce name).
module Types
  class ProjectAttributesInput < Types::BaseInputObject
    argument :name, String, required: false
    argument :role, String, required: false
    argument :url, String, required: false
    argument :description, String, required: false
    argument :start_date, GraphQL::Types::ISO8601Date, required: false
    argument :end_date, GraphQL::Types::ISO8601Date, required: false
  end
end

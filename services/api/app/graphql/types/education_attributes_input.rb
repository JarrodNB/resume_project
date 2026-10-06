# frozen_string_literal: true

# Description: Editable education fields. All optional so it serves both create and update
# (model validations enforce institution).
module Types
  class EducationAttributesInput < Types::BaseInputObject
    argument :institution, String, required: false
    argument :degree, String, required: false
    argument :field_of_study, String, required: false
    argument :start_date, GraphQL::Types::ISO8601Date, required: false
    argument :end_date, GraphQL::Types::ISO8601Date, required: false
    argument :description, String, required: false
  end
end

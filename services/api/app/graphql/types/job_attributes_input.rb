# frozen_string_literal: true

# Description: Editable job profile fields. All optional so it serves both create and update
# (model validations enforce title and company).
module Types
  class JobAttributesInput < Types::BaseInputObject
    argument :title, String, required: false
    argument :company, String, required: false
    argument :location, String, required: false
    argument :url, String, required: false
    argument :description, String, required: false
    argument :requirements, [ String ], required: false
    argument :nice_to_haves, [ String ], required: false
    argument :notes, String, required: false
  end
end

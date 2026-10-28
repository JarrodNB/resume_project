# frozen_string_literal: true

# Description: Editable library-context fields. All optional so it serves both create and update
# (model validations enforce requirement and response).
module Types
  class CareerContextAttributesInput < Types::BaseInputObject
    argument :requirement, String, required: false
    argument :response, String, required: false
  end
end

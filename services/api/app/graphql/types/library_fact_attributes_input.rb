# frozen_string_literal: true

# Description: Editable library-fact fields. All optional so it serves both create and update
# (model validations enforce requirement and response).
module Types
  class LibraryFactAttributesInput < Types::BaseInputObject
    argument :requirement, String, required: false
    argument :response, String, required: false
  end
end

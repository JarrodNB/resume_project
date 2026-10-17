# frozen_string_literal: true

# Editable job fields shared by create and update. The model requires a title;
# a missing company is allowed, and services normalize blank companies to null.
module Types
  class JobAttributesInput < Types::BaseInputObject
    argument :title, String, required: false
    argument :company, String, required: false
    argument :location, String, required: false
    argument :url, String, required: false
    argument :description, String, required: false
    argument :requirements, [ String ], required: false
    argument :responsibilities, [ String ], required: false
    argument :nice_to_haves, [ String ], required: false
    argument :notes, String, required: false
  end
end

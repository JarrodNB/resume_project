# frozen_string_literal: true

# Description: Editable profile fields. All optional so a caller can change one field.
# Sign-in email and password are not included.
module Types
  class ProfileAttributesInput < Types::BaseInputObject
    argument :name, String, required: false
    argument :contact_email, String, required: false
    argument :phone, String, required: false
    argument :location, String, required: false
    argument :links, [ Types::ProfileLinkAttributesInput ], required: false
    argument :summary, String, required: false
    argument :include_summary, Boolean, required: false
  end
end

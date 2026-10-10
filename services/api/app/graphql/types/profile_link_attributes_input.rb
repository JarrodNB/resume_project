# frozen_string_literal: true

# Description: Editable label and destination for one profile link.
# Index:
#   - label: visible link text
#   - url: hyperlink destination
module Types
  class ProfileLinkAttributesInput < Types::BaseInputObject
    argument :label, String, required: true
    argument :url, String, required: true
  end
end
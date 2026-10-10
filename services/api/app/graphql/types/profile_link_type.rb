# frozen_string_literal: true

# Description: One profile link with the text shown on a resume and its click destination.
# Index:
#   - label: visible link text
#   - url: hyperlink destination
module Types
  class ProfileLinkType < Types::BaseObject
    field :label, String, null: false
    field :url, String, null: false
  end
end
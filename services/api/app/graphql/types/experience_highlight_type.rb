# frozen_string_literal: true

# Description: One bullet point of an experience.
module Types
  class ExperienceHighlightType < Types::BaseObject
    field :id, ID, null: false
    field :content, String, null: false
    field :position, Integer, null: false
  end
end

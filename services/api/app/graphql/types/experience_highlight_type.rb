# frozen_string_literal: true

# Description: One bullet point of an experience.
module Types
  class ExperienceHighlightType < Types::BaseObject
    field :id, ID, null: false
    field :experience_role_id, ID, description: "Null when shared across the experience."
    field :content, String, null: false
    field :position, Integer, null: false
  end
end

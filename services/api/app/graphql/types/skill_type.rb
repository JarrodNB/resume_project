# frozen_string_literal: true

# Description: Career library skill.
module Types
  class SkillType < Types::BaseObject
    field :id, ID, null: false
    field :name, String, null: false
    field :category, String
    field :position, Integer, null: false
  end
end

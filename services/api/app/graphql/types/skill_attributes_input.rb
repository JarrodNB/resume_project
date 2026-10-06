# frozen_string_literal: true

# Description: Editable skill fields. All optional so it serves both create and update
# (model validations enforce name). Position is set by create and by reorderSkills.
module Types
  class SkillAttributesInput < Types::BaseInputObject
    argument :name, String, required: false
    argument :category, String, required: false
  end
end

# A stable bullet in a nested experience list; omit ID to add a new bullet.
module Types
  class ExperienceHighlightAttributesInput < Types::BaseInputObject
    argument :id, ID, required: false
    argument :content, String, required: true
  end
end

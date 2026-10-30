# User-editable preference text, priority, and optional stable identity from a prior read.
module Types
  class JobPreferenceCriterionInput < Types::BaseInputObject
    argument :id, ID, required: false
    argument :text, String, required: true
    argument :priority, String, required: true
  end
end

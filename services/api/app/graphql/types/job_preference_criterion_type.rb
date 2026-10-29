# A confirmed or draft condition for the user's next job, never career evidence.
module Types
  class JobPreferenceCriterionType < Types::BaseObject
    field :id, ID, null: false
    field :text, String, null: false
    field :priority, String, null: false
  end
end

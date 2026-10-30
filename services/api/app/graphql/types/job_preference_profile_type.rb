# Exposes private editable preferences separately from their confirmed snapshot.
module Types
  class JobPreferenceProfileType < Types::BaseObject
    field :version, Integer, null: false
    field :confirmed_revision, Integer, null: false
    field :draft_criteria, [ Types::JobPreferenceCriterionType ], null: false
    field :confirmed_criteria, [ Types::JobPreferenceCriterionType ], null: false
  end
end

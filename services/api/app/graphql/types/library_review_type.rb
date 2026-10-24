# The selected section's latest task and last completed, freshness-checked assessments.
module Types
  class LibraryReviewType < Types::BaseObject
    field :ai_task, Types::AiTaskType
    field :assessments, [ Types::LibraryAssessmentType ], null: false
  end
end

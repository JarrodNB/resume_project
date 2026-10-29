# A recoverable summary proposal and whether its original evidence is still current.
module Types
  class SummaryGenerationType < Types::BaseObject
    field :ai_task, Types::AiTaskType
    field :stale, Boolean, null: false
  end
end

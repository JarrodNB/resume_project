# A resumable edit's task and source freshness; model history remains server-side.
module Types
  class LibraryEditType < Types::BaseObject
    field :ai_task, Types::AiTaskType
    field :stale, Boolean, null: false
  end
end

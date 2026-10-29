# Expose only public dialogue, owned task state and the profile revision warning.
module Types
  class JobPreferenceConversationType < Types::BaseObject
    field :ai_task, Types::AiTaskType
    field :turns, [Types::JobPreferenceConversationTurnType], null: false
    field :stale, Boolean, null: false
  end
end

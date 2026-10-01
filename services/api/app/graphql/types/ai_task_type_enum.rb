# frozen_string_literal: true

# Description: Kind of AI work (mirrors AiTask::TASK_TYPES).
module Types
  class AiTaskTypeEnum < Types::BaseEnum
    extend EnumFromValues
    values_from AiTask::TASK_TYPES
  end
end

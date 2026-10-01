# frozen_string_literal: true

# Description: Status of an AI task (mirrors AiTask::STATUSES).
module Types
  class AiTaskStatusEnum < Types::BaseEnum
    extend EnumFromValues
    values_from AiTask::STATUSES
  end
end

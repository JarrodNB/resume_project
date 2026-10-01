# frozen_string_literal: true

# Description: Application stage of a job (mirrors Job::STAGES).
module Types
  class JobStageEnum < Types::BaseEnum
    extend EnumFromValues
    values_from Job::STAGES
  end
end

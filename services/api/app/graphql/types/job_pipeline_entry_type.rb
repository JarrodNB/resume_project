# frozen_string_literal: true

# Description: One saved job on the Home pipeline paired with its suggested next step.
module Types
  class JobPipelineEntryType < Types::BaseObject
    description "A saved job and the one thing to do next for it."

    field :job, Types::JobType, null: false, description: "The saved job."
    field :next_step, Types::JobNextStepEnum, null: false, description: "The suggested next step for this job."
  end
end

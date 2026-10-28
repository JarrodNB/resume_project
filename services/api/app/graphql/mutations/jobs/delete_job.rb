# frozen_string_literal: true

# Description: Legacy archive action for older clients; retains the job and all linked records.
module Mutations
  module Jobs
    class DeleteJob < Mutations::BaseMutation
      argument :id, ID, required: true

      field :job, Types::JobType

      # Archives rather than deleting saved data.
      def resolve(id:)
        job = current_user.jobs.find(id)
        payload_from(::Jobs::ArchiveJobService.call(job: job), :job)
      end
    end
  end
end

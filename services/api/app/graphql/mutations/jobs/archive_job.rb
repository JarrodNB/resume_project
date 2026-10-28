# frozen_string_literal: true

# Description: Archives one of the signed-in user's jobs without deleting its data.
module Mutations
  module Jobs
    class ArchiveJob < Mutations::BaseMutation
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

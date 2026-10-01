# frozen_string_literal: true

# Description: Deletes one of the signed-in user's jobs (tailored resumes are kept, unlinked).
module Mutations
  module Jobs
    class DeleteJob < Mutations::BaseMutation
      argument :id, ID, required: true

      field :job, Types::JobType

      # Calls Records::DestroyRecordService.
      def resolve(id:)
        job = current_user.jobs.find(id)
        payload_from(::Records::DestroyRecordService.call(record: job), :job)
      end
    end
  end
end

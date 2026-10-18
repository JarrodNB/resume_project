# frozen_string_literal: true

# Removes an owned resume and its saved sections while keeping the job and task history.
module Mutations
  module ResumeTailoring
    class DeleteResume < Mutations::BaseMutation
      argument :id, ID, required: true

      field :resume, Types::ResumeType

      def resolve(id:)
        resume = current_user.resumes.find(id)
        payload_from(::Records::DestroyRecordService.call(record: resume), :resume)
      end
    end
  end
end

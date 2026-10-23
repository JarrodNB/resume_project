# frozen_string_literal: true

# Updates the Markdown of one of the signed-in user's saved resumes.
module Mutations
  module ResumeTailoring
    class UpdateResume < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :markdown, String, required: true

      field :resume, Types::ResumeType

      # Calls the resume update service after finding the owned record.
      def resolve(id:, markdown:)
        resume = current_user.resumes.find(id)
        payload_from(
          ::ResumeTailoring::UpdateResumeService.call(resume: resume, markdown: markdown),
          :resume
        )
      end
    end
  end
end

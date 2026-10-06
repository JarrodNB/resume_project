# frozen_string_literal: true

# Description: Updates the section content of one of the signed-in user's saved resumes.
module Mutations
  module ResumeTailoring
    class UpdateResume < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :sections, GraphQL::Types::JSON, required: true,
               description: "Sections to update, as a list of { id, content }."

      field :resume, Types::ResumeType

      # Calls ResumeTailoring::UpdateResumeSectionsService.
      def resolve(id:, sections:)
        resume = current_user.resumes.find(id)
        payload_from(
          ::ResumeTailoring::UpdateResumeSectionsService.call(resume: resume, sections: sections),
          :resume
        )
      end
    end
  end
end

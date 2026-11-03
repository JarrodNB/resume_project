# frozen_string_literal: true

# Updates saved section content, section order and the summary inclusion choice for an owned resume.
module Mutations
  module ResumeTailoring
    class UpdateResume < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :sections, GraphQL::Types::JSON, required: true,
               description: "Sections to update, as a list of { id, content }."

      argument :include_summary, Boolean, required: false
      argument :section_order, [ ID ], required: false,
               description: "Every section id on this resume in the new order, with contact first."

      field :resume, Types::ResumeType

      # Calls ResumeTailoring::UpdateResumeSectionsService.
      def resolve(id:, sections:, include_summary: nil, section_order: nil)
        resume = current_user.resumes.find(id)
        payload_from(
          ::ResumeTailoring::UpdateResumeSectionsService.call(resume: resume, sections: sections, include_summary: include_summary, section_order: section_order),
          :resume
        )
      end
    end
  end
end

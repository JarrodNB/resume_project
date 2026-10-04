# frozen_string_literal: true

# Description: Moves a highlight within a role or into another of the signed-in user's roles.
module Mutations
  module Experiences
    class MoveExperienceHighlight < Mutations::BaseMutation
      argument :highlight_id, ID, required: true
      argument :experience_id, ID, required: true, description: "The role the highlight ends up in."
      argument :position, Int, required: true, description: "Its index among that role's highlights."

      field :experience, Types::ExperienceType, description: "The role the highlight is now in."
      field :source_experience, Types::ExperienceType, description: "The role the highlight came from."

      # Looks up both records through the user's experiences and calls Experiences::MoveHighlightService.
      def resolve(highlight_id:, experience_id:, position:)
        highlight = ExperienceHighlight.where(experience: current_user.experiences).find(highlight_id)
        source_experience = highlight.experience
        result = ::Experiences::MoveHighlightService.call(
          highlight: highlight, experience: current_user.experiences.find(experience_id), position: position
        )
        { experience: result.value, source_experience: result.success? ? source_experience.reload : nil, errors: result.errors }
      end
    end
  end
end

# frozen_string_literal: true

# Description: Updates one of the signed-in user's job profiles.
module Mutations
  module Jobs
    class UpdateJob < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :attributes, Types::JobAttributesInput, required: true

      field :job, Types::JobType

      # Calls Jobs::UpdateJobService.
      def resolve(id:, attributes:)
        job = current_user.jobs.find(id)
        payload_from(::Jobs::UpdateJobService.call(job: job, attributes: attributes.to_h), :job)
      end
    end
  end
end

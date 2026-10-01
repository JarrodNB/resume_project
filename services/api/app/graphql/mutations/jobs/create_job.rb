# frozen_string_literal: true

# Description: Creates a job profile for the signed-in user.
module Mutations
  module Jobs
    class CreateJob < Mutations::BaseMutation
      argument :attributes, Types::JobAttributesInput, required: true

      field :job, Types::JobType

      # Calls Jobs::CreateJobService.
      def resolve(attributes:)
        payload_from(::Jobs::CreateJobService.call(user: current_user, attributes: attributes.to_h), :job)
      end
    end
  end
end

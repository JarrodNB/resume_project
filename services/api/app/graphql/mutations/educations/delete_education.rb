# frozen_string_literal: true

# Description: Removes an education entry from the signed-in user's career library.
module Mutations
  module Educations
    class DeleteEducation < Mutations::BaseMutation
      argument :id, ID, required: true

      field :education, Types::EducationType

      # Calls Records::DestroyRecordService.
      def resolve(id:)
        education = current_user.educations.find(id)
        payload_from(::Records::DestroyRecordService.call(record: education), :education)
      end
    end
  end
end

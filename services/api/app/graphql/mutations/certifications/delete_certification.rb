# frozen_string_literal: true

# Description: Removes a certification entry from the signed-in user's career library.
# Index: resolve delegates the authorized lifecycle operation
module Mutations
  module Certifications
    class DeleteCertification < Mutations::BaseMutation
      argument :id, ID, required: true

      field :certification, Types::CertificationType

      # Calls Records::DestroyRecordService.
      def resolve(id:)
        certification = current_user.certifications.find(id)
        payload_from(::Records::DestroyRecordService.call(record: certification), :certification)
      end
    end
  end
end

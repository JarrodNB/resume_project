# frozen_string_literal: true

# Description: Updates a certification entry in the signed-in user's career library.
# Index: resolve delegates the authorized lifecycle operation
module Mutations
  module Certifications
    class UpdateCertification < Mutations::BaseMutation
      argument :id, ID, required: true
      argument :attributes, Types::CertificationAttributesInput, required: true

      field :certification, Types::CertificationType

      # Calls Certifications::UpdateCertificationService.
      def resolve(id:, attributes:)
        certification = current_user.certifications.find(id)
        payload_from(::Certifications::UpdateCertificationService.call(certification: certification, attributes: attributes.to_h), :certification)
      end
    end
  end
end

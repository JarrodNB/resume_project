# frozen_string_literal: true

# Description: Adds a certification entry to the signed-in user's career library.
# Index: resolve delegates the authorized lifecycle operation
module Mutations
  module Certifications
    class CreateCertification < Mutations::BaseMutation
      argument :attributes, Types::CertificationAttributesInput, required: true

      field :certification, Types::CertificationType

      # Calls CareerLibrary::SaveLibraryEntryService.
      def resolve(attributes:)
        payload_from(::CareerLibrary::SaveLibraryEntryService.call(user: current_user, kind: :certification, attributes: attributes.to_h), :certification)
      end
    end
  end
end

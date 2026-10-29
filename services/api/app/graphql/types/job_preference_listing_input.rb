# Identify each currently loaded listing by its server-issued full-source digest.
module Types
  class JobPreferenceListingInput < Types::BaseInputObject
    argument :listing_id, ID, required: true
    argument :expected_digest, String, required: true
  end
end

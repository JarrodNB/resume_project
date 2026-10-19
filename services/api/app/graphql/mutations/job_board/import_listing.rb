# Imports a shared listing into the signed-in owner's Jobs. The service owns
# private-job matching and writes; shared listing lookup is intentional.
module Mutations
  module JobBoard
    class ImportListing < Mutations::BaseMutation
      argument :listing_id, ID, required: true
      field :job, Types::JobType
      field :warnings, [ String ], null: false

      def resolve(listing_id:)
        listing = ::JobBoardListing.find(listing_id)
        result = ::JobBoard::ImportListingService.call(user: current_user, listing: listing)
        { job: result.value&.fetch(:job), warnings: result.value&.fetch(:warnings) || [], errors: result.errors }
      end
    end
  end
end

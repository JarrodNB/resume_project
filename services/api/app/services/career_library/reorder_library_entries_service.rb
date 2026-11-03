# Description: Saves a new order for one list of positioned records (a user's skills, or the
# sections of one resume). The ids must be exactly the records in that list; each record's
# position becomes its index in the list. Running it twice with the same ids changes nothing.
# Index:
#   - call: renumbers positions in one transaction; returns the reordered records, or errors
module CareerLibrary
  class ReorderLibraryEntriesService < ApplicationService
    # @param records [ActiveRecord::Relation] the records to order (e.g. user.skills)
    # @param ordered_ids [Array<String, Integer>] every id in that relation, in the new order
    def initialize(records:, ordered_ids:)
      @records = records
      @ordered_ids = ordered_ids.map(&:to_s)
    end

    # Sets each record's position to its index in `ordered_ids`.
    def call
      return failure([ "The new order must list each entry exactly once" ]) unless lists_every_entry_once?

      ActiveRecord::Base.transaction do
        @ordered_ids.each_with_index do |id, position|
          @records.where(id: id).update_all(position: position, updated_at: Time.current)
        end
      end
      success(@records.reload.to_a)
    end

    private

    # True when the ids are the relation's ids with no duplicates, missing, or extra entries.
    def lists_every_entry_once?
      @ordered_ids.uniq.size == @ordered_ids.size &&
        @ordered_ids.sort == @records.pluck(:id).map(&:to_s).sort
    end
  end
end

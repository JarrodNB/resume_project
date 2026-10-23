# Reloads persisted experience children under row locks before assigning text edits.
# Call only after locking all parent entries in ID order inside the write transaction.
# Unsaved import sources keep their in-memory roles and bullets, including ownership.
module Experiences
  class LockChildrenService < ApplicationService
    def initialize(experience:)
      @experience = experience
    end

    def call
      if @experience.persisted?
        %i[roles highlights].each do |name|
          association = @experience.association(name)
          rows = association.scope.reorder(:id).lock.to_a
          association.target = rows.sort_by { |row| [ row.position, row.id ] }
          association.loaded!
        end
      end
      success(@experience)
    end
  end
end

# Description: Updates a career library skill's name or category and queues an embedding sync.
# Position is left alone so a rename doesn't undo a drag-and-drop order.
# Index:
#   - call: applies the attributes; returns the skill, or validation errors
module Skills
  class UpdateSkillService < ApplicationService
    def initialize(skill:, attributes:)
      @skill = skill
      @attributes = attributes
    end

    # Applies the attributes.
    def call
      return failure(@skill.errors) unless @skill.update(@attributes)

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@skill.user_id)
      success(@skill)
    end
  end
end

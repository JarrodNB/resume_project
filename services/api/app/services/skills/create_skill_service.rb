# Description: Adds a skill to the user's career library, after their other skills, and queues
# an embedding sync.
# Index:
#   - call: saves the skill; returns it, or validation errors
module Skills
  class CreateSkillService < ApplicationService
    def initialize(user:, attributes:)
      @user = user
      @attributes = attributes
    end

    # Saves the skill at the end of the user's list.
    def call
      skill = @user.skills.new(@attributes)
      skill.position = next_position
      return failure(skill.errors) unless skill.save

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@user.id)
      success(skill)
    end

    private

    # One past the highest position, or 0 when the user has no skills yet.
    def next_position
      max = @user.skills.maximum(:position)
      max.nil? ? 0 : max + 1
    end
  end
end

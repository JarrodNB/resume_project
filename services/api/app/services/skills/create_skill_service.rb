# Description: Adds a skill to the user's career library, after their other skills, and queues
# an embedding sync. Duplicate-name errors identify the existing owned skill.
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
      skill.position = (@user.skills.maximum(:position) || -1) + 1
      return failure(ValidationErrors.messages_for(skill)) unless skill.save

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@user.id)
      success(skill)
    end
  end
end

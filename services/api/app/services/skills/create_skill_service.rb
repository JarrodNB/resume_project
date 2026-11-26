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

    # Saves the skill at the end of the user's list. The user lock makes the position, the
    # duplicate-name check and the size limit apply to one request at a time.
    def call
      skill = @user.skills.new(@attributes)
      saved = @user.with_lock do
        skill.position = (@user.skills.maximum(:position) || -1) + 1
        skill.save
      end
      return failure(ValidationErrors.messages_for(skill)) unless saved

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@user.id)
      success(skill)
    rescue ActiveRecord::RecordNotUnique
      # A twin request committed the same name after validation passed; report it like a normal duplicate.
      failure([ "You already have a skill called #{skill.name}" ])
    end
  end
end

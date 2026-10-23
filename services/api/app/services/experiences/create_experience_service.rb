# Creates an employment entry with nested ordered roles and scoped stable bullets.
# The old flat title/date plus string-bullet input remains a single-role adapter.
module Experiences
  class CreateExperienceService < ApplicationService
    def initialize(user:, attributes:, highlights: [])
      @user = user
      @attributes = attributes
      @highlights = highlights
    end

    # Saves all children atomically and queues embedding synchronization.
    def call
      if @attributes.key?(:roles) || @attributes.key?(:shared_highlights) || @attributes.key?(:removed_highlight_ids)
        return failure([ "Use nested roles and typed bullets together" ]) if @highlights.present? || (@attributes.keys.map(&:to_s) & SingleRoleCompatibility::ROLE_FIELDS).any?
        return WriteGroupedExperienceService.call(experience: @user.experiences.new, attributes: @attributes)
      end

      experience = @user.experiences.new(@attributes.except(*SingleRoleCompatibility::ROLE_FIELDS.map(&:to_sym), :description))
      @highlights.each_with_index do |content, position|
        experience.highlights.build(content: content, position: position)
      end
      SingleRoleCompatibility.prepare!(experience, attributes: @attributes)
      return failure(experience.errors) unless experience.save

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@user.id)
      success(experience)
    end
  end
end

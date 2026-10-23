# Updates an employment entry through nested roles and typed bullet lists, preserving IDs.
# Legacy flat writes remain available when their target scope is unambiguous.
module Experiences
  class UpdateExperienceService < ApplicationService
    def initialize(experience:, attributes:, highlights: nil)
      @experience = experience
      @attributes = attributes
      @highlights = highlights
    end

    # Delegates grouped writes or applies the locked single-role adapter.
    def call
      if @attributes.key?(:roles) || @attributes.key?(:shared_highlights) || @attributes.key?(:removed_highlight_ids)
        return failure([ "Use nested roles and typed bullets together" ]) unless @highlights.nil? && (@attributes.keys.map(&:to_s) & SingleRoleCompatibility::ROLE_FIELDS).empty?
        return WriteGroupedExperienceService.call(experience: @experience, attributes: @attributes)
      end
      return failure([ SingleRoleCompatibility::GROUPED_ERROR ]) if @experience.roles.size > 1

      ActiveRecord::Base.transaction do
        @experience.lock!
        return failure([ SingleRoleCompatibility::GROUPED_ERROR ]) if @experience.roles.size > 1
        if !@highlights.nil? && @experience.roles.exists? && @experience.highlights.where(experience_role_id: nil).exists?
          return failure([ SingleRoleCompatibility::GROUPED_ERROR ])
        end
        @experience.assign_attributes(@attributes)
        CareerLibrary::RecordScreeningService.discard_changed_fields(record: @experience)
        replace_highlights if @highlights
        SingleRoleCompatibility.prepare!(@experience, edited_fields: @attributes.keys)
        raise ActiveRecord::Rollback unless @experience.save
      end
      return failure(@experience.errors) if @experience.errors.any?

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@experience.user_id)
      success(@experience.reload)
    end

    private

    # Deletes the current highlights and builds the new list.
    def replace_highlights
      @experience.highlights.reload.destroy_all
      @experience.highlights.reset
      @highlights.each_with_index do |content, position|
        @experience.highlights.build(content: content, position: position)
      end
    end
  end
end

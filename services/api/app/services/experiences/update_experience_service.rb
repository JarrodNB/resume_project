# Reloads under the row lock so field edits and screening invalidation stay atomic.
# Description: Updates a career library role. When highlights are given, they replace the
# existing bullet points (in the given order). Queues an embedding sync on success.
# Index:
#   - call: updates in one transaction; returns the experience, or validation errors
module Experiences
  class UpdateExperienceService < ApplicationService
    def initialize(experience:, attributes:, highlights: nil)
      @experience = experience
      @attributes = attributes
      @highlights = highlights
    end

    # Updates the experience and, if given, replaces its highlights.
    def call
      @experience.with_lock do
        @experience.assign_attributes(@attributes)
        CareerLibrary::RecordScreeningService.discard_changed_fields(record: @experience)
        replace_highlights if @highlights
        raise ActiveRecord::Rollback unless @experience.save
      end
      return failure(@experience.errors) if @experience.errors.any?

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@experience.user_id)
      success(@experience.reload)
    end

    private

    # Deletes the current highlights and builds the new list.
    def replace_highlights
      @experience.highlights.destroy_all
      @highlights.each_with_index do |content, position|
        @experience.highlights.build(content: content, position: position)
      end
    end
  end
end

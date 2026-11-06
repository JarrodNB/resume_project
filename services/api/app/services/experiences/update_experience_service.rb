# Updates a career library role under its row lock and queues an embedding sync.
# Submitted bullets replace the list in order, but exact unchanged text keeps its
# record identity, saved reviews, and screening coverage. Changed text starts unchecked.
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
        @experience.discard_changed_screened_fields
        replace_highlights if @highlights
        raise ActiveRecord::Rollback unless @experience.save
      end
      return failure(@experience.errors) if @experience.errors.any?

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@experience.user_id)
      success(@experience.reload)
    end

    private

    # Match each saved bullet at most once, including when content is duplicated.
    # Review and edit tasks refer to these IDs, so unchanged bullets must survive saves.
    def replace_highlights
      existing = @experience.highlights.to_a.group_by(&:content)
      covered = @experience.highlights.select { |item| item.screened_fields.include?("content") }.map(&:content).to_set
      @highlights.each_with_index do |content, position|
        highlight = existing[content]&.shift
        if highlight
          highlight.update!(position: position)
        else
          @experience.highlights.build(content: content, position: position,
            screened_fields: covered.include?(content) ? [ "content" ] : [])
        end
      end
      existing.each_value { |items| items.each(&:destroy!) }
    end
  end
end

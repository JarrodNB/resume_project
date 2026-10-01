# Description: Updates a career library role. When highlights are given, they replace the
# existing bullet points (in the given order).
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
      ActiveRecord::Base.transaction do
        @experience.assign_attributes(@attributes)
        replace_highlights if @highlights
        raise ActiveRecord::Rollback unless @experience.save
      end
      @experience.errors.any? ? failure(@experience.errors) : success(@experience.reload)
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

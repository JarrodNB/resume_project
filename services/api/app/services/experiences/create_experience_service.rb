# Description: Adds a role to the user's career library, with its bullet points.
# Index:
#   - call: saves the experience and highlights together; returns it, or validation errors
module Experiences
  class CreateExperienceService < ApplicationService
    def initialize(user:, attributes:, highlights: [])
      @user = user
      @attributes = attributes
      @highlights = highlights
    end

    # Saves the experience and its highlights.
    def call
      experience = @user.experiences.new(@attributes)
      @highlights.each_with_index do |content, position|
        experience.highlights.build(content: content, position: position)
      end
      experience.save ? success(experience) : failure(experience.errors)
    end
  end
end

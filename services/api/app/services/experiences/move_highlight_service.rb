# Description: Moves a highlight (bullet point) to a position in an experience: the same one
# (reorder) or another of the user's experiences. The highlight keeps its id. Positions in the
# experiences involved are renumbered from 0. Running it twice with the same arguments changes
# nothing the second time.
# Index:
#   - call: moves and renumbers in one transaction; returns the target experience, or errors
module Experiences
  class MoveHighlightService < ApplicationService
    # @param highlight [ExperienceHighlight] the bullet point to move (already scoped to the user)
    # @param experience [Experience] the role it moves into (already scoped to the user)
    # @param position [Integer] its index among the target's highlights; clamped to the list end
    def initialize(highlight:, experience:, position:)
      @highlight = highlight
      @experience = experience
      @position = position
    end

    # Moves the highlight and renumbers both experiences' highlights.
    def call
      error = invalid_move_error
      return failure([ error ]) if error

      source_experience = @highlight.experience
      ActiveRecord::Base.transaction do
        renumber(@experience, target_order)
        renumber(source_experience, highlights_without_moved(source_experience)) if source_experience.id != @experience.id
      end
      success(@experience.reload)
    end

    private

    # Returns why the move isn't allowed, or nil.
    def invalid_move_error
      if @position.negative?
        "Position can't be negative"
      elsif @highlight.experience.user_id != @experience.user_id
        "Only your own entries can be changed"
      end
    end

    # The target's highlights with the moved one inserted at the requested position.
    def target_order
      others = highlights_without_moved(@experience)
      others.insert(@position.clamp(0, others.size), @highlight)
    end

    # An experience's highlights, in order, leaving out the one being moved.
    def highlights_without_moved(experience)
      experience.highlights.where.not(id: @highlight.id).order(:position, :id).to_a
    end

    # Assigns each highlight to the experience with its index as position.
    def renumber(experience, highlights)
      highlights.each_with_index do |highlight, position|
        highlight.update_columns(experience_id: experience.id, position: position, updated_at: Time.current)
      end
    end
  end
end

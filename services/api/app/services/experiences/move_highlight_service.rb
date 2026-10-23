# Moves a stable bullet within a shared/role list or between owned experiences.
# Locks parents in a consistent order, renumbers affected scopes, and synchronizes
# embeddings when its entry or role context changes. Explicit nil selects shared scope.
module Experiences
  class MoveHighlightService < ApplicationService
    # @param highlight [ExperienceHighlight] the bullet point to move (already scoped to the user)
    # @param experience [Experience] the role it moves into (already scoped to the user)
    # @param position [Integer] its index among the target's highlights; clamped to the list end
    def initialize(highlight:, experience:, position:, experience_role_id: :legacy)
      @highlight = highlight
      @experience = experience
      @position = position
      @legacy_scope = experience_role_id == :legacy
      @role_id = experience_role_id
    end

    # Moves the highlight and renumbers both experiences' highlights.
    def call
      source_experience = @highlight.experience
      source_role_id = @highlight.experience_role_id
      ActiveRecord::Base.transaction do
        [ source_experience, @experience ].uniq(&:id).sort_by(&:id).each(&:lock!)
        @experience.reload if source_experience.id == @experience.id && !source_experience.equal?(@experience)
        @highlight.reload
        return failure([ "This bullet moved. Reload the library and try again." ]) if @highlight.experience_id != source_experience.id
        source_role_id = @highlight.experience_role_id
        @role_id = @experience.roles.first&.id if @legacy_scope && @experience.roles.size <= 1
        error = invalid_move_error
        return failure([ error ]) if error

        renumber(@experience, target_order)
        renumber(source_experience, highlights_without_moved(source_experience, source_role_id), source_role_id) if source_experience.id != @experience.id || source_role_id != @role_id
      end
      sync_embeddings_if_role_changed(source_experience, source_role_id)
      success(@experience.reload)
    end

    private

    # A highlight's embedding text names its role, so moving it to another role re-syncs.
    def sync_embeddings_if_role_changed(source_experience, source_role_id)
      return if source_experience.id == @experience.id && source_role_id == @role_id

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@experience.user_id)
    end

    # Returns why the move isn't allowed, or nil.
    def invalid_move_error
      if @position.negative?
        "Position can't be negative"
      elsif @highlight.experience.user_id != @experience.user_id
        "Only your own entries can be changed"
      elsif @role_id == :legacy || (@legacy_scope && @highlight.experience.roles.size > 1)
        SingleRoleCompatibility::GROUPED_ERROR
      elsif @role_id && !@experience.roles.exists?(id: @role_id)
        "The role must belong to the target experience"
      elsif moving_onto_a_full_role?
        "You can save up to #{TextLimits::MAX_HIGHLIGHTS_PER_ROLE} bullets on a role"
      end
    end

    # A move onto another role adds a bullet. Reordering within a role does not.
    def moving_onto_a_full_role?
      return false if @highlight.experience_id == @experience.id && @highlight.experience_role_id == @role_id

      highlights_without_moved(@experience).size >= TextLimits::MAX_HIGHLIGHTS_PER_ROLE
    end

    # The target's highlights with the moved one inserted at the requested position.
    def target_order
      others = highlights_without_moved(@experience)
      others.insert(@position.clamp(0, others.size), @highlight)
    end

    # An experience's highlights, in order, leaving out the one being moved.
    def highlights_without_moved(experience, role_id = @role_id)
      experience.highlights.where(experience_role_id: role_id).where.not(id: @highlight.id).order(:position, :id).to_a
    end

    # Assigns each highlight to the experience with its index as position.
    def renumber(experience, highlights, role_id = @role_id)
      highlights.each_with_index do |highlight, position|
        attributes = { experience_id: experience.id, position: position, updated_at: Time.current }
        attributes[:experience_role_id] = role_id
        highlight.update_columns(attributes)
      end
    end
  end
end

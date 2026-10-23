# Saves one experience and its ordered roles together. Nested bullet lists bind new
# bullets to unsaved roles; existing child IDs must belong to this entry. Omitted lists
# keep their bullets, while explicit lists replace membership without replacing IDs.
module Experiences
  class WriteGroupedExperienceService < ApplicationService
    def initialize(experience:, attributes:)
      @experience = experience
      @attributes = attributes.deep_symbolize_keys
    end

    def call
      ActiveRecord::Base.transaction do
        @experience.lock! if @experience.persisted?
        LockChildrenService.call(experience: @experience)
        @experience.id ||= SecureRandom.uuid
        old_roles = @experience.roles.to_a
        @bullets = @experience.highlights.to_a.index_by(&:id)
        @seen = Set.new
        removed_ids = Array(@attributes.delete(:removed_highlight_ids))
        invalid!("Removed bullet IDs must be unique and belong to this experience") if removed_ids.uniq.size != removed_ids.size || (removed_ids - @bullets.keys).any?
        @deletions = removed_ids.to_set
        roles_input = @attributes.delete(:roles)
        shared = @attributes.delete(:shared_highlights)
        @experience.assign_attributes(@attributes)
        roles = roles_input ? assign_roles(roles_input, old_roles) : old_roles
        invalid!("An experience needs at least one role") if roles.empty?
        invalid!("You can save up to 20 titles per experience") if roles.size > TextLimits::MAX_ROLES_PER_EXPERIENCE
        removed = old_roles - roles
        # Validate membership before deleting any children, including bullets explicitly moved.
        lists = roles_input ? roles_input.zip(roles).filter_map { |input, role| [ role, input[:highlights] ] unless input[:highlights].nil? } : []
        lists << [ nil, shared ] unless shared.nil?
        lists.each { |role, items| assign_bullets(role, items) }
        invalid!("A bullet cannot be retained and removed together") if (removed_ids.to_set & @seen).any?
        (@deletions - @seen).each { |id| @bullets.fetch(id).destroy! }
        removed.each do |role|
          invalid!("Reassign or remove this role's bullets before removing the role") if @bullets.values.any? { |bullet| !bullet.destroyed? && bullet.experience_role_id == role.id }
        end
        @experience.roles.target.replace(roles)
        CareerLibrary::RecordScreeningService.discard_changed_fields(record: @experience)
        @experience.save!
        roles.each(&:save!)
        @bullets.values.reject(&:destroyed?).each(&:save!)
        removed.each(&:destroy!)
      end
      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@experience.user_id)
      success(@experience.reload)
    rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotDestroyed => error
      failure(error.record.errors)
    end

    private

    def invalid!(message)
      @experience.errors.add(:base, message)
      raise ActiveRecord::RecordInvalid, @experience
    end

    def assign_roles(inputs, existing)
      ids = inputs.filter_map { |input| input[:id] }
      invalid!("Role IDs must be unique and belong to this experience") if ids.uniq.size != ids.size || (ids - existing.map(&:id)).any?
      # The unique position constraint is deferred so swaps remain within bounds.
      ActiveRecord::Base.connection.execute("SET CONSTRAINTS experience_roles_position_unique DEFERRED")
      inputs.each_with_index.map do |input, index|
        role = input[:id] ? existing.find { |item| item.id == input[:id] } : @experience.roles.build(id: SecureRandom.uuid)
        role.assign_attributes(input.except(:id, :highlights).merge(position: index))
        CareerLibrary::RecordScreeningService.discard_changed_fields(record: role)
        role
      end
    end

    def assign_bullets(role, inputs)
      ids = inputs.filter_map { |input| input[:id] }
      invalid!("Bullet IDs must be unique and belong to this experience") if ids.uniq.size != ids.size || (ids - @bullets.keys).any? || (@seen & ids.to_set).any?
      @seen.merge(ids)
      scope_id = role&.id
      @bullets.values.select { |bullet| bullet.experience_role_id == scope_id && !ids.include?(bullet.id) }.each do |bullet|
        # Another explicitly supplied list may move this bullet; delete after all lists.
        @deletions.add(bullet.id)
      end
      inputs.each_with_index do |input, position|
        bullet = input[:id] ? @bullets.fetch(input[:id]) : @experience.highlights.build(id: SecureRandom.uuid)
        bullet.assign_attributes(content: input[:content], position: position, experience_role: role)
        CareerLibrary::RecordScreeningService.discard_changed_fields(record: bullet)
        @bullets[bullet.id] = bullet
      end
      # Destruction is delayed until all scopes have been processed.
    end
  end
end

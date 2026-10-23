# Explicitly combines two owned entries without flattening titles or bullet scope.
# Existing roles and bullets retain IDs when moved; identical text is deduplicated only
# inside the same resulting scope. Automatic import matching is a separate decision.
module Experiences
  class MergeExperiencesService < ApplicationService
    def initialize(target:, source:)
      @target, @source = target, source
    end

    def call
      # Roll back our writes before returning failure, even inside an owner lock transaction.
      ActiveRecord::Base.transaction(requires_new: true) do
        [ @target, @source ].select(&:persisted?).sort_by(&:id).each(&:lock!)
        [ @target, @source ].sort_by { |entry| entry.id.to_s }.each { |entry| LockChildrenService.call(experience: entry) }
        @source.roles.each { |role| role.id ||= SecureRandom.uuid }
        target_roles = @target.roles.to_a
        mapped = {}
        used_roles = Set.new
        @source.roles.each do |role|
          match = target_roles.find { |other| !used_roles.include?(other.object_id) && EntryStructure.role_matches?(other, role) }
          unless match
            match = role
            match.experience = @target
            match.position = target_roles.size
            target_roles << match
          end
          match.start_date ||= role.start_date
          match.description = combined_text(match.description, role.description)
          CareerLibrary::RecordScreeningService.discard_changed_fields(record: match)
          mapped[role.id] = match
          used_roles.add(match.object_id)
        end
        @target.roles.target.replace(target_roles)
        @target.location = @source.location if @target.location.blank?
        @target.description = combined_text(@target.description, @source.description)
        CareerLibrary::RecordScreeningService.discard_changed_fields(record: @target)
        @target.save!
        target_roles.each(&:save!)
        known = @target.highlights.map { |bullet| [ bullet.experience_role_id, EntryStructure.normalize(bullet.content) ] }.to_set
        position = @target.highlights.maximum(:position).to_i + 1
        @source.highlights.each do |bullet|
          source_role = bullet.experience_role
          role = source_role ? mapped[source_role.id] : nil
          next unless known.add?([ role&.id, EntryStructure.normalize(bullet.content) ])

          bullet.assign_attributes(experience: @target, experience_role: role, position: position)
          bullet.save!
          position += 1
        end
        # Reload so dependent deletion only sees children still owned by the source.
        @source.reload.destroy! if @source.persisted?
        @target.reload
        @target.save!
      end
      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@target.user_id)
      success(@target)
    rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotDestroyed => error
      failure(error.record.errors)
    end

    private

    def combined_text(left, right)
      return left if right.blank? || EntryStructure.normalize(left) == EntryStructure.normalize(right)
      return right if left.blank?

      "#{left}\n\n#{right}"
    end
  end
end

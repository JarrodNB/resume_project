# Save, confirm, or clear one owner's preference revision under the owner lock.
# The monotonic version rejects stale browser edits, including edits made before a clear.
module JobPreferences
  class UpdateProfileService < ApplicationService
    MAX_CRITERIA = 10
    MAX_TEXT = 500
    PRIORITIES = %w[must_have nice_to_have].freeze
    STALE_MESSAGE = "Preferences changed. Reload them before saving or confirming."

    # @param action [Symbol] :save_draft, :confirm, or :clear
    # @param expected_version [Integer] the version last read by this caller
    def initialize(user:, expected_version:, action:, criteria: nil)
      @user, @expected_version, @action, @criteria = user, expected_version, action, criteria
    end

    def call
      return failure([ "Invalid preference update." ]) unless %i[save_draft confirm clear].include?(@action)

      @user.with_lock do
        profile = @user.reload.job_preference_profile || @user.build_job_preference_profile
        return failure([ STALE_MESSAGE ]) unless @expected_version == profile.version

        if @action == :save_draft
          validated = validated_criteria(profile)
          return validated unless validated.success?
          profile.draft_criteria = validated.value
        elsif @action == :confirm
          profile.confirmed_criteria = profile.draft_criteria.deep_dup
          profile.confirmed_revision = profile.version + 1
        else
          profile.draft_criteria = []
          profile.confirmed_criteria = []
          profile.confirmed_revision = profile.version + 1
        end
        profile.version += 1
        profile.save!
        success(profile)
      end
    end

    private

    def validated_criteria(profile)
      return failure([ "Save up to #{MAX_CRITERIA} preferences." ]) unless @criteria.is_a?(Array) && @criteria.size <= MAX_CRITERIA
      known_ids = (profile.draft_criteria + profile.confirmed_criteria).pluck("id")
      ids = []
      values = @criteria.map do |raw|
        value = raw.to_h.stringify_keys
        text, priority, id = value.values_at("text", "priority", "id")
        return failure([ "Each preference needs 1–#{MAX_TEXT} characters and a valid priority." ]) unless text.is_a?(String) &&
          text.strip.present? && text.length <= MAX_TEXT && !text.match?(/[[:cntrl:]]/) && PRIORITIES.include?(priority)
        return failure([ "A preference no longer exists. Reload your preferences." ]) if id.present? && !known_ids.include?(id)
        id = SecureRandom.uuid if id.blank?
        return failure([ "Each preference must appear only once." ]) if ids.include?(id)
        ids << id
        { "id" => id, "text" => text.strip, "priority" => priority }
      end
      success(values)
    end
  end
end

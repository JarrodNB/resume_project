# Keeps the old title/date write contract usable while roles become canonical. Call prepare!
# inside the caller's save transaction. Grouped edits must use the later grouped editor.
module Experiences
  module SingleRoleCompatibility
    ROLE_FIELDS = %w[title start_date end_date].freeze
    GROUPED_ERROR = "Use the grouped experience editor to change entries with multiple roles".freeze

    module_function

    # Builds the canonical role for legacy records, applies explicitly edited flat fields,
    # then projects canonical values back onto the compatibility columns. Existing shared
    # highlights remain shared; newly built legacy bullets belong to the single role.
    def prepare!(experience, edited_fields: ROLE_FIELDS)
      raise ArgumentError, GROUPED_ERROR if experience.roles.size > 1

      # Highlights autosave before the roles collection. Allocate the parent UUID now
      # so a new bullet can save its new role with the correct parent reference.
      experience.id ||= SecureRandom.uuid
      role = experience.roles.to_a.first || experience.roles.build(position: 0)
      ROLE_FIELDS.each do |field|
        role[field] = experience[field] if role.new_record? || edited_fields.map(&:to_s).include?(field)
        experience[field] = role[field]
      end
      experience.highlights.each do |highlight|
        highlight.experience_role = role if highlight.new_record?
      end
      role
    end
  end
end

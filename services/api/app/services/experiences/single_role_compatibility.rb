# Adapts old single-role requests into canonical roles before saving. Persisted entries
# must already have roles; this is an input adapter, never a second source of truth.
module Experiences
  module SingleRoleCompatibility
    ROLE_FIELDS = %w[title start_date end_date].freeze
    GROUPED_ERROR = "Use the grouped experience editor to change entries with multiple roles".freeze

    module_function

    # Apply only explicitly supplied fields. New string bullets belong to the sole role;
    # existing shared bullets retain their scope. Caller owns the transaction and locks.
    def prepare!(experience, attributes:)
      raise ArgumentError, GROUPED_ERROR if experience.roles.size > 1

      experience.id ||= SecureRandom.uuid
      role = experience.roles.to_a.first || experience.roles.build(position: 0)
      role.assign_attributes(attributes.stringify_keys.slice(*ROLE_FIELDS))
      CareerLibrary::RecordScreeningService.discard_changed_fields(record: role)
      experience.highlights.each do |highlight|
        highlight.experience_role = role if highlight.new_record?
      end
      role
    end
  end
end

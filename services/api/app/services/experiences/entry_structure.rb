# Compares entire employment blocks conservatively, keeping role order and bullet scope.
# Matching reads canonical roles, including unsaved children built by the import adapter.
module Experiences
  module EntryStructure
    module_function

    def roles(entry)
      entry.roles.to_a
    end

    def normalize(value)
      value.to_s.squish.downcase
    end

    def role_matches?(left, right)
      normalize(left.title) == normalize(right.title) &&
        (left.start_date.nil? || right.start_date.nil? || left.start_date == right.start_date) && left.end_date == right.end_date
    end

    def matches?(left, right)
      left_roles, right_roles = roles(left), roles(right)
      return false unless normalize(left.company) == normalize(right.company) && left_roles.size == right_roles.size
      return false unless left_roles.zip(right_roles).all? { |a, b| role_matches?(a, b) }

      scopes(left, left_roles) == scopes(right, right_roles)
    end

    def scopes(entry, roles)
      # Text can grow on reimport; scope presence, rather than individual bullet wording,
      # distinguishes shared evidence from a role-owned list.
      entry.highlights.map do |bullet|
        role = bullet.experience_role
        role ? roles.index { |candidate| candidate.equal?(role) || (role.id && candidate.id == role.id) } : :shared
      end.uniq.sort_by(&:to_s)
    end
  end
end

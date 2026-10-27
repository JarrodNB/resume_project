# Validate optional provider filters once for HTTP requests and shared cache identity.
# Missing values stay unrestricted; sets use a stable order and unknown inputs fail closed.
module JobBoard
  class SearchFilters
    EMPLOYMENT_TYPES = %w[FULL_TIME PART_TIME CONTRACT INTERN TEMPORARY FREELANCE APPRENTICESHIP VOLUNTEER PER_DIEM OTHER].freeze
    REMOTE_TYPES = %w[fully_remote remote_country remote_region hybrid].freeze
    KEYS = %i[max_age city_id state_id employment_types remote_type minimum_salary include_undisclosed_salaries company_name sort_by].freeze

    def self.normalize(input)
      return unless input.is_a?(Hash) && (input.keys - KEYS).empty?
      value = input.compact
      return unless value[:max_age].nil? || %w[24h 7d 30d].include?(value[:max_age])
      return unless value[:remote_type].nil? || REMOTE_TYPES.include?(value[:remote_type])
      return unless value[:sort_by].nil? || %w[published relevance].include?(value[:sort_by])
      return unless %i[city_id state_id].all? { |key| value[key].nil? || (value[key].is_a?(Integer) && value[key].between?(1, 2_147_483_647)) }
      return if value[:city_id] && value[:state_id]
      return unless value[:minimum_salary].nil? || (value[:minimum_salary].is_a?(Integer) && value[:minimum_salary].between?(1, 1_000_000_000))
      return unless value[:include_undisclosed_salaries].nil? || [ true, false ].include?(value[:include_undisclosed_salaries])
      types = value.fetch(:employment_types, [])
      return unless types.is_a?(Array) && types.all? { |type| EMPLOYMENT_TYPES.include?(type) }
      company = value[:company_name]
      return unless company.nil? || (company.is_a?(String) && company.valid_encoding? && company.length <= 200 && !company.match?(/[[:cntrl:]]/))

      normalized = value.slice(:max_age, :city_id, :state_id, :remote_type, :minimum_salary)
      normalized[:employment_types] = EMPLOYMENT_TYPES.select { |type| types.include?(type) } if types.any?
      normalized[:company_name] = company.strip.gsub(/ +/, " ").downcase if company && !company.strip.empty?
      normalized[:include_undisclosed_salaries] = false if value[:minimum_salary] && value[:include_undisclosed_salaries] == false
      normalized[:sort_by] = "relevance" if value[:sort_by] == "relevance"
      normalized.sort.to_h
    end

    def self.parameters(filters)
      filters.each_with_object({}) do |(key, value), result|
        case key
        when :employment_types then result[:employment_type] = value.join(",")
        when :minimum_salary then result[:salary] = value
        when :include_undisclosed_salaries then result[:require_salary] = "true" unless value
        else result[key] = value
        end
      end
    end
  end
end

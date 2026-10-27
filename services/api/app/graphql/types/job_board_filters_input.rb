# Optional search preferences, validated by the provider boundary before HTTP or caching.
module Types
  class JobBoardFiltersInput < Types::BaseInputObject
    argument :max_age, String, required: false
    argument :city_id, Integer, required: false
    argument :state_id, Integer, required: false
    argument :employment_types, [ String ], required: false
    argument :remote_type, String, required: false
    argument :minimum_salary, Integer, required: false
    argument :include_undisclosed_salaries, Boolean, required: false
    argument :company_name, String, required: false
    argument :sort_by, String, required: false
  end
end

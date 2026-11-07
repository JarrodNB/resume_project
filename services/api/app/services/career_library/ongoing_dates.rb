# Keeps explicit ongoing status and optional end dates consistent for library form saves.
# Unknown dates remain distinct from ongoing; setting an end date marks the entry finished.
module CareerLibrary
  module OngoingDates
    def self.normalize(attributes)
      values = attributes.to_h.symbolize_keys
      if values[:ongoing] == true
        values.merge(end_date: nil)
      elsif values[:end_date].present?
        values.merge(ongoing: false)
      elsif values.key?(:ongoing)
        values.merge(ongoing: values[:ongoing] == true)
      else
        values
      end
    end
  end
end

# Description: Immutable outcome of a service call.
# Index:
#   - success?: true when the service succeeded
#   - value: the service's return value (e.g. the saved record)
#   - errors: human-readable error messages when it failed
ServiceResult = Data.define(:success, :value, :errors) do
  # Returns true when the service succeeded.
  def success?
    success
  end
end

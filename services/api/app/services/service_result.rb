# Description: Immutable outcome of a service call.
# Index:
#   - success?: true when the service succeeded
#   - value: the service's return value (e.g. the saved record)
#   - errors: human-readable error messages when it failed
#   - code: optional machine-readable reason for a failure (a symbol), so callers never match on message text
ServiceResult = Data.define(:success, :value, :errors, :code) do
  def initialize(success:, value:, errors:, code: nil) = super

  # Returns true when the service succeeded.
  def success?
    success
  end
end

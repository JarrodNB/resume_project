# Description: Base class for service objects. Services hold all business logic and expose
# one public method, `call`, returning a ServiceResult.
# Index:
#   - self.call: builds the service with the given arguments and runs it
#   - success / failure: helpers for building a ServiceResult
class ApplicationService
  # Runs the service: `Jobs::CreateJobService.call(user:, attributes:)`.
  def self.call(...)
    new(...).call
  end

  private

  # Builds a successful result wrapping the given value.
  def success(value = nil)
    ServiceResult.new(success: true, value: value, errors: [])
  end

  # Builds a failed result. Accepts an array of messages or an ActiveModel::Errors.
  def failure(errors)
    messages = errors.respond_to?(:full_messages) ? errors.full_messages : Array(errors)
    ServiceResult.new(success: false, value: nil, errors: messages)
  end
end

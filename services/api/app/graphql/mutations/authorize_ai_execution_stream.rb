# Authorize read-only output attachment using the current persisted browser session.
module Mutations
  class AuthorizeAiExecutionStream < BaseMutation
    argument :feature, String, required: true
    argument :operation_id, ID, required: true
    field :token, String, null: true
    field :expires_at, String, null: true

    def resolve(feature:, operation_id:)
      result = AiExecutions::AuthorizeStreamService.call(user: current_user,
        session_id: context[:browser_session_id], feature: feature, operation_id: operation_id)
      result.success? ? result.value.merge(errors: []) : { errors: result.errors }
    end
  end
end

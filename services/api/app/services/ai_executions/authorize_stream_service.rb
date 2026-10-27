# Issue a read-only capability after authenticating the browser and owned attempt.
require "digest"

module AiExecutions
  class AuthorizeStreamService < ApplicationService
    def initialize(user:, session_id:, feature:, operation_id:)
      @user, @session_id, @feature, @operation_id = user, session_id, feature, operation_id
    end

    def call
      return failure("Streaming unavailable") unless ENV["AI_STREAMING_ENABLED"] == "true"
      identity = BrowserSessions::ResolveSessionIdentityService.call(session_id: @session_id)
      return failure("Authentication required") unless @user && identity.success? && identity.value.id == @user.id

      authority = Features.stream_authority(@feature)
      @user.with_lock do
        next failure("Too many active stream capabilities") if AiExecutionStreamGrant.where(user: @user)
          .where("expires_at > ?", Time.current).count >= 8
        operation = authority.operation(@operation_id, @user)
        next failure("Stream unavailable") unless operation
        authority.lock(operation)
        next failure("Stream unavailable") unless authority.current?(operation,
          attempt_id: operation.attempt_id, claim_generation: operation.claim_generation) && operation.attempt_id.present?

        token = SecureRandom.urlsafe_base64(32)
        grant = AiExecutionStreamGrant.create!(user: @user, session_digest: @session_id.private_id,
          feature: @feature, operation_id: operation.id, attempt_id: operation.attempt_id,
          claim_generation: operation.claim_generation, token_digest: Digest::SHA256.hexdigest(token),
          expires_at: [ 60.seconds.from_now, authority.expires_at(operation) ].min)
        success({ token: token, expires_at: grant.expires_at.iso8601 })
      end
    rescue ArgumentError
      failure("Stream unavailable")
    end
  end
end

# Redeem or revalidate one observer grant without starting or altering execution.
require "digest"

module AiExecutions
  class StreamGrantService < ApplicationService
    def initialize(action:, token: nil, grant_id: nil)
      @action, @token, @grant_id = action, token, grant_id
    end

    def call
      return failure("Streaming unavailable") unless ENV["AI_STREAMING_ENABLED"] == "true"
      return failure("Invalid stream action") unless %w[redeem check].include?(@action)
      if @action == "redeem"
        return failure("Invalid capability") unless @token.is_a?(String) && @token.length.between?(40, 100)
        grant = AiExecutionStreamGrant.find_by(token_digest: Digest::SHA256.hexdigest(@token))
      else
        grant = AiExecutionStreamGrant.find_by(id: @grant_id)
      end
      return failure("Stream unavailable") unless grant

      grant.user.with_lock do
        operation = StreamAuthority.operation(grant.feature, grant.operation_id, grant.user)
        next failure("Stream unavailable") unless operation
        operation.interview_session.lock!
        operation.lock!
        grant.lock!
        identity = BrowserSessions::ResolveSessionIdentityService.call(private_id: grant.session_digest)
        valid = grant.expires_at > Time.current && identity.success? && identity.value.id == grant.user_id &&
          StreamAuthority.current?(operation, attempt_id: grant.attempt_id, claim_generation: grant.claim_generation)
        next failure("Stream unavailable") unless valid
        if @action == "redeem"
          next failure("Capability already used") if grant.redeemed_at
          grant.update!(redeemed_at: Time.current)
        else
          next failure("Capability not redeemed") unless grant.redeemed_at
        end
        success({ grant_id: grant.id, feature: grant.feature, operation_id: grant.operation_id,
          attempt_id: grant.attempt_id, claim_generation: grant.claim_generation, expires_at: grant.expires_at.iso8601 })
      end
    end
  end
end

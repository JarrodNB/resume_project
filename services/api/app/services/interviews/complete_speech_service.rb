# Attaches one sealed speech artifact to exactly the saved message and current claim.
# Duplicate completion returns the persisted receipt without regenerating dialogue.
require "digest"

module Interviews
  class CompleteSpeechService < ApplicationService
    include MediaPolicy

    def initialize(media:, attempt_id:, claim_generation:)
      @media, @attempt_id, @generation = media, attempt_id, claim_generation
    end

    def call
      with_media_lock(@media) do
        next failure("Audio unavailable or expired") unless @media.speech? && @media.ready? && media_live?(@media)
        operation = @media.operation
        identity = { "media_id" => @media.id, "message_id" => @media.message_id,
          "attempt_id" => @attempt_id, "claim_generation" => @generation }
        if operation.accepted?
          next operation.accepted_result == identity ? success(identity) : failure("Speech completion conflicts")
        end
        next failure("Claim is stale or expired") unless media_claim?(@media)
        next failure("Saved message differs") unless operation.message_id == @media.message_id &&
          operation.interview_session_id == @media.interview_session_id && operation.question_id == @media.question_id
        operation.update!(status: "accepted", accepted_at: Time.current, accepted_result: identity,
          result_fingerprint: Digest::SHA256.hexdigest(JSON.generate(identity)))
        operation.ai_task&.update!(status: "completed", completed_at: Time.current)
        interview = @media.interview_session
        @media.update!(expires_at: [ interview.expires_at, (interview.completed_at + 1.hour if interview.completed_at) ].compact.min)
        success(identity)
      end
    end
  end
end

# Grants a current speech execution an immutable staging reservation for its saved
# message. Size and checksum become fixed at registration after synthesis finishes.
module Interviews
  class ReserveSpeechMediaService < ApplicationService
    include ExecutionPolicy
    include MediaPolicy

    def initialize(operation:, attempt_id:, claim_generation:, content_type:, storage: MediaStorage.new)
      @operation, @attempt_id, @generation, @type, @storage = operation, attempt_id, claim_generation, content_type, storage
    end

    def call
      return failure("Invalid audio type") unless TYPES.include?(@type)
      result = with_operation_lock do |interview|
        next failure("Claim is stale or expired") unless @operation.speech? && current_claim? && !expire_operation(interview)
        media = InterviewSessionMedia.find_by(operation: @operation, attempt_id: @attempt_id, kind: "speech")
        next failure("Reservation conflicts") if media && media.content_type != @type
        media ||= InterviewSessionMedia.create!(interview_session: interview, question: @operation.question,
          operation: @operation, message: @operation.message, kind: "speech", content_type: @type,
          attempt_id: @attempt_id, claim_generation: @generation,
          staging_key: "interviews/staging/#{SecureRandom.uuid}", sealed_key: "interviews/sealed/#{SecureRandom.uuid}",
          expires_at: [ 1.hour.from_now, interview.expires_at, (interview.completed_at + 1.hour if interview.completed_at) ].compact.min)
        next failure("Media expired") unless media_live?(media)
        success(media)
      end
      return result unless result.success?
      receipt = upload_receipt(result.value, @storage)
      receipt ? success(receipt) : failure("Media expired")
    end
  end
end

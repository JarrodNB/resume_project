# Reserves one owned recording for the current question. Its upload grant can write
# only a staging key; registration copies verified bytes into a private sealed key.
module Interviews
  class ReserveRecordingService < ApplicationService
    include MediaPolicy

    def initialize(interview:, question_id:, expected_revision:, content_type:, byte_size:, checksum:, storage: MediaStorage.new(browser: true))
      @interview, @question_id, @revision = interview, question_id, expected_revision
      @content_type, @byte_size, @checksum, @storage = content_type, byte_size, checksum, storage
    end

    def call
      return failure("Invalid audio metadata") unless valid_metadata?(@content_type, @byte_size, @checksum)
      result = @interview.user.with_lock do
        @interview.lock!
        next failure("Interview is not active") unless @interview.active? && @interview.expires_at > Time.current
        next failure("Interview revision is stale") unless @revision == @interview.revision
        question = @interview.questions.lock.find_by(id: @question_id, position: @interview.current_question_position)
        next failure("Question is not current") unless question
        next failure("An answer is already processing") if @interview.operations.turn.where(status: %w[pending running]).exists?
        media = InterviewSessionMedia.create!(interview_session: @interview, question: question, kind: "recording",
          staging_key: "interviews/staging/#{SecureRandom.uuid}", sealed_key: "interviews/sealed/#{SecureRandom.uuid}",
          content_type: @content_type, byte_size: @byte_size, checksum: @checksum,
          metadata: { "expected_revision" => @revision },
          expires_at: [ 1.hour.from_now, @interview.expires_at ].min)
        success(media)
      end
      return result unless result.success?
      receipt = upload_receipt(result.value, @storage)
      receipt ? success(receipt) : failure("Media expired")
    end
  end
end

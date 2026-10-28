# Records the desired feedback state on an already-authorized accepted reply.
# Row locking makes repeated or concurrent saves idempotent without touching dialogue or billing.
module Chat
  class SetMessageFeedbackService < ApplicationService
    def initialize(message:, thumbs_down:)
      @message, @thumbs_down = message, thumbs_down
    end

    def call
      @message.with_lock do
        return failure([ "Feedback is available only on saved assistant replies." ]) unless @message.assistant?
        return failure([ "Feedback must be true or false." ]) unless [ true, false ].include?(@thumbs_down)

        return failure(@message.errors) unless @message.update(thumbs_down: @thumbs_down)
      end
      success(@message)
    end
  end
end

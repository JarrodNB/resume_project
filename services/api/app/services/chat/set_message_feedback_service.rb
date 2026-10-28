# Records the desired feedback state on an already-authorized accepted reply.
# Row locking makes repeated or concurrent saves idempotent without touching dialogue or billing.
module Chat
  class SetMessageFeedbackService < ApplicationService
    def initialize(message:, thumbs_down: nil, thumbs_up: nil)
      @message, @thumbs_down, @thumbs_up = message, thumbs_down, thumbs_up
    end

    def call
      @message.with_lock do
        return failure([ "Feedback is available only on saved assistant replies." ]) unless @message.assistant?
        return failure([ "Choose one feedback action." ]) unless [@thumbs_down, @thumbs_up].count { |v| [true, false].include?(v) } == 1

        changes = @thumbs_up.nil? ? { thumbs_down: @thumbs_down } : { thumbs_up: @thumbs_up }
        changes[:thumbs_up] = false if @thumbs_down == true
        changes[:thumbs_down] = false if @thumbs_up == true
        return failure(@message.errors) unless @message.update(changes)
      end
      success(@message)
    end
  end
end

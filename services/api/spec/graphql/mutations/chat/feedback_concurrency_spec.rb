# Uses committed records and real row locks to verify duplicate desired-state feedback saves.
require "rails_helper"

RSpec.describe "Concurrent chat reply feedback" do
  self.use_transactional_tests = false

  it "keeps two concurrent thumbs-down saves set rather than toggling twice" do
    user = create(:user)
    conversation = create(:chat_conversation, user: user)
    reply = create(:chat_message, chat_conversation: conversation)
    mutation = 'mutation($conversationId: ID!, $messageId: ID!) { setChatMessageFeedback(input: { conversationId: $conversationId, messageId: $messageId, thumbsDown: true }) { message { thumbsDown } errors } }'
    gate = Queue.new
    threads = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          gate.pop
          execute_graphql(mutation, user: user, variables: { conversationId: conversation.id, messageId: reply.id })
        end
      end
    end
    2.times { gate << true }
    responses = threads.map(&:value)
    expect(responses.map { |response| response.dig("data", "setChatMessageFeedback", "errors") }).to eq([ [], [] ])
    expect(reply.reload.thumbs_down).to be(true)
    expect(user.ai_tasks.count).to eq(0)
  ensure
    threads&.each(&:join)
    user&.destroy!
  end
end

# Saved chat fixtures stay independent from paid model work.
FactoryBot.define do
  factory :chat_conversation do
    user
    title { "New chat" }
  end

  factory :chat_message do
    chat_conversation
    sequence(:position)
    role { "assistant" }
    content { "What career decision would you like to talk through?" }
  end
end

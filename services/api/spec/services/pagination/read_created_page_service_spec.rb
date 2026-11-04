# Verify cursor scope and continuation with real records, including the existing signed format.
require "rails_helper"

RSpec.describe Pagination::ReadCreatedPageService do
  let(:user) { create(:user) }
  let(:params) { { records: user.chat_conversations, cursor: nil, binding: { "user_id" => user.id }, purpose: "chat-conversations", limit: 2 } }

  it "continues the existing cursor format and orders equal timestamps without duplicates" do
    rows = Array.new(3) { create(:chat_conversation, user: user, created_at: Time.current.change(usec: 0)) }.sort_by(&:id).reverse
    token = Rails.application.message_verifier("chat-conversations").generate(
      { "user_id" => user.id, "created_at" => rows[1].created_at.iso8601(6), "id" => rows[1].id }, purpose: "chat-conversations")
    first = described_class.call(**params).value
    expect(first[:records].map(&:id)).to eq(rows.first(2).map(&:id))
    expect(described_class.call(**params.merge(cursor: token)).value[:records].map(&:id)).to eq([ rows.last.id ])
    last = described_class.call(**params.merge(cursor: first[:next_cursor])).value
    expect(last[:records].map(&:id)).to eq([ rows.last.id ])
    expect(last[:next_cursor]).to be_nil
  end

  it "rejects another scope, another purpose, invalid signatures and malformed signed positions" do
    3.times { create(:chat_conversation, user: user) }
    cursor = described_class.call(**params).value[:next_cursor]
    expect(described_class.call(**params.merge(cursor: cursor, binding: { "user_id" => create(:user).id }))).not_to be_success
    expect(described_class.call(**params.merge(cursor: cursor, purpose: "study-guide-history"))).not_to be_success
    expect(described_class.call(**params.merge(cursor: cursor + "tampered"))).not_to be_success
    verifier = Rails.application.message_verifier("chat-conversations")
    [ { "user_id" => user.id }, { "user_id" => user.id, "created_at" => "not a timestamp", "id" => user.id } ].each do |payload|
      expect(described_class.call(**params.merge(cursor: verifier.generate(payload, purpose: "chat-conversations")))).not_to be_success
    end
  end
end

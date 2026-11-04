# Verify feature registrations route real saved operations and keep stream opt-in separate.
require "rails_helper"

RSpec.describe AiExecutions::Features do
  let(:user) { create(:user) }
  before { allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: :accepted, errors: [])) }

  it "resolves each feature's domain and only its operation model" do
    interview = Interviews::CreateFixtureService.call(user: user).value
    spoken = interview.operations.first
    chat = Chat::StartMessageService.call(conversation: user.chat_conversations.create!, message: "Career question", idempotency_key: "registry").value
    expect(described_class.domain("interviews")).to eq(Interviews)
    expect(described_class.domain("chat")).to eq(Chat)
    expect(described_class.operation("interviews", spoken.id)).to eq(spoken)
    expect(described_class.operation("chat", chat.id)).to eq(chat)
    expect(described_class.operation("interviews", chat.id)).to be_nil
    expect(described_class.operation("chat", spoken.id)).to be_nil
  end

  it "allows lifecycle dispatch when a feature has no streaming authority" do
    registration = described_class::REGISTRY.fetch("chat").except(:stream_authority).freeze
    stub_const("AiExecutions::Features::REGISTRY", { "chat" => registration }.freeze)
    expect(described_class.domain("chat")).to eq(Chat)
    expect(described_class.state("chat", SecureRandom.uuid)).to eq(delivered: true)
    expect { described_class.stream_authority("chat") }.to raise_error(ArgumentError, "Unknown execution feature")
  end

  it "rejects unregistered feature names before resolving classes or operations" do
    [ "Kernel", "ChatOperation", "unknown", nil ].each do |feature|
      expect { described_class.domain(feature) }.to raise_error(ArgumentError, "Unknown execution feature")
      expect { described_class.operation(feature, SecureRandom.uuid) }.to raise_error(ArgumentError, "Unknown execution feature")
      expect { described_class.stream_authority(feature) }.to raise_error(ArgumentError, "Unknown execution feature")
    end
  end
end

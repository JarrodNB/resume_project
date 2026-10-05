# Description: The embedding sync job runs the sync service, and skips without an API key or user.
require "rails_helper"

RSpec.describe CareerLibrary::SyncLibraryEmbeddingsJob do
  let(:user) { create(:user) }

  before { allow(CareerLibrary::SyncLibraryEmbeddingsService).to receive(:call) }

  it "syncs the user's embeddings" do
    allow(Embeddings::OpenAiEmbeddingClient).to receive(:configured?).and_return(true)

    described_class.perform_now(user.id)

    expect(CareerLibrary::SyncLibraryEmbeddingsService).to have_received(:call).with(user: user)
  end

  it "does nothing without an OpenAI API key" do
    allow(Embeddings::OpenAiEmbeddingClient).to receive(:configured?).and_return(false)

    described_class.perform_now(user.id)

    expect(CareerLibrary::SyncLibraryEmbeddingsService).not_to have_received(:call)
  end

  it "does nothing for a deleted user" do
    allow(Embeddings::OpenAiEmbeddingClient).to receive(:configured?).and_return(true)

    described_class.perform_now(SecureRandom.uuid)

    expect(CareerLibrary::SyncLibraryEmbeddingsService).not_to have_received(:call)
  end
end

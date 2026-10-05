# Description: Syncing library embeddings: new entries are embedded, unchanged ones skipped, changed
# ones re-embedded, deleted ones removed, a model change re-embeds, and other users are untouched.
require "rails_helper"

RSpec.describe CareerLibrary::SyncLibraryEmbeddingsService do
  let(:user) { create(:user) }
  let(:client) { FakeEmbeddingClient.new }

  def sync(embedding_client = client)
    described_class.call(user: user, embedding_client: embedding_client)
  end

  # An uncategorized skill, so its embedding text is just the name.
  def create_skill(name)
    create(:skill, user: user, name: name, category: nil)
  end

  it "embeds every entry the first time" do
    experience = create(:experience, user: user, title: "Engineer", company: "Acme")
    highlight = create(:experience_highlight, experience: experience, content: "Built the API")

    result = sync

    expect(result.value).to eq(embedded: 2, deleted: 0)
    row = user.library_embeddings.find_by!(source_type: "ExperienceHighlight", source_id: highlight.id)
    expect(row.content).to eq("Engineer at Acme: Built the API")
    expect(row.model).to eq(CareerLibraryEmbeddings::MODEL)
    expect(row.embedding.to_a).to eq(FakeEmbeddingClient.vector_for(row.content))
  end

  it "skips unchanged entries, so running twice embeds nothing new" do
    create_skill("Ruby")
    sync

    expect(sync.value).to eq(embedded: 0, deleted: 0)
    expect(client.embedded_texts).to eq([ "Ruby" ])
  end

  it "re-embeds an entry whose text changed" do
    skill = create_skill("Ruby")
    sync
    skill.update!(category: "Languages")

    expect(sync.value).to eq(embedded: 1, deleted: 0)
    expect(user.library_embeddings.sole.content).to eq("Languages: Ruby")
  end

  it "deletes embeddings of entries that are gone" do
    experience = create(:experience, user: user)
    create(:experience_highlight, experience: experience)
    sync
    experience.destroy!

    expect(sync.value).to eq(embedded: 0, deleted: 2)
    expect(user.library_embeddings).to be_empty
  end

  it "re-embeds everything when the model changes" do
    create_skill("Ruby")
    sync

    result = sync(FakeEmbeddingClient.new(model: "text-embedding-3-large"))

    expect(result.value).to eq(embedded: 1, deleted: 0)
    expect(user.library_embeddings.sole.model).to eq("text-embedding-3-large")
  end

  it "leaves other users' embeddings alone" do
    other_embedding = create(:library_embedding)
    create_skill("Ruby")

    sync

    expect(LibraryEmbedding.exists?(other_embedding.id)).to be(true)
    expect(client.embedded_texts).to eq([ "Ruby" ])
  end

  it "finds the closest entries by cosine distance" do
    create_skill("Go")
    create_skill("Ruby")
    sync

    closest = user.library_embeddings.nearest_neighbors(:embedding, FakeEmbeddingClient.vector_for("Ruby"), distance: "cosine").first

    expect(closest.content).to eq("Ruby")
  end
end

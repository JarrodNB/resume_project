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
    expect(row.content).to eq("Acme: Built the API")
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

  it "sends placeholders to the embedding API and stores the original text" do
    user.update!(name: "Ada Lovelace", contact_email: "ada@example.com", phone: "555-0100")
    experience = create(:experience, user: user, title: "Engineer", company: "Acme")
    highlight = create(:experience_highlight, experience: experience, content: "Ada Lovelace shipped it. ada@example.com 555-0100")
    original = "Acme: Ada Lovelace shipped it. ada@example.com 555-0100"
    masked = "Acme: «name» shipped it. «email» «phone»"

    sync

    row = user.library_embeddings.find_by!(source_type: "ExperienceHighlight", source_id: highlight.id)
    expect(row.content).to eq(original)
    expect(client.embedded_texts).to include(masked)
    expect(row.embedding.to_a).to eq(FakeEmbeddingClient.vector_for(masked))
    expect(sync.value).to eq(embedded: 0, deleted: 0)

    user.update!(contact_email: "ada@other.com")
    expect(sync.value).to eq(embedded: 1, deleted: 0)
  end

  it "finds the closest entries by cosine distance" do
    create_skill("Go")
    create_skill("Ruby")
    sync

    closest = user.library_embeddings.nearest_neighbors(:embedding, FakeEmbeddingClient.vector_for("Ruby"), distance: "cosine").first

    expect(closest.content).to eq("Ruby")
  end
  it "syncs certification facts and removes deleted credentials idempotently" do
    credential = create(:certification, user: user, credential_id: "ABC", expiry_date: Date.new(2027, 1, 1))
    create(:certification)
    expect(sync.value).to eq(embedded: 1, deleted: 0)
    expect(user.library_embeddings.sole).to have_attributes(source_type: "Certification", source_id: credential.id)
    expect(user.library_embeddings.sole.content).to include("Credential id: ABC", "Expiry date: 2027-01-01")
    expect(sync.value).to eq(embedded: 0, deleted: 0)
    credential.destroy!
    expect(sync.value).to eq(embedded: 0, deleted: 1)
  end

  it "resyncs changed role context while preserving shared bullet digests and source ids" do
    experience = create(:experience, user: user, company: "Acme")
    role = experience.roles.first.tap { |item| item.update!(title: "Developer", start_date: nil) }
    shared = experience.highlights.create!(content: "Shared work", position: 0)
    scoped = experience.highlights.create!(content: "Role work", position: 1, experience_role: role)
    sync
    rows = user.library_embeddings.index_by(&:source_id)
    original_ids = rows.transform_values(&:id)
    shared_digest = rows.fetch(shared.id).content_digest
    role.update!(title: "Lead")
    expect(sync.value).to eq(embedded: 2, deleted: 0)
    changed = user.library_embeddings.reload.index_by(&:source_id)
    expect(changed.transform_values(&:id)).to eq(original_ids)
    expect(changed.fetch(shared.id).content_digest).to eq(shared_digest)
    expect(changed.fetch(scoped.id).content).to eq("Lead at Acme: Role work")
    expect(sync.value).to eq(embedded: 0, deleted: 0)
  end

end

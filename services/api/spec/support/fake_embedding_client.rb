# Description: A stand-in for Embeddings::OpenAiEmbeddingClient, so specs never call OpenAI.
# Each text gets a deterministic vector, and every call is recorded.
# Index:
#   - FakeEmbeddingClient#embed_texts: one vector per text; texts appended to `embedded_texts`
#   - FakeEmbeddingClient.vector_for: the vector a text maps to
class FakeEmbeddingClient
  attr_reader :model, :embedded_texts

  def initialize(model: CareerLibraryEmbeddings::MODEL)
    @model = model
    @embedded_texts = []
  end

  # Records the texts and returns one vector each.
  def embed_texts(texts)
    @embedded_texts.concat(texts)
    texts.map { |text| self.class.vector_for(text) }
  end

  # A unit-length vector whose direction depends on the text's length (cheap but distinct).
  def self.vector_for(text)
    Array.new(CareerLibraryEmbeddings::DIMENSIONS, 0.0).tap { |vector| vector[text.length % vector.size] = 1.0 }
  end
end

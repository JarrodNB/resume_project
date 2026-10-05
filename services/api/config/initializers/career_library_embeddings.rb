# Description: Embedding settings for the career library. The AI worker embeds search queries with
# the same model (services/ai worker settings), and only searches rows whose `model` matches, so
# changing the model means re-running `bin/rails career_library:sync_embeddings`.
# Index:
#   - CareerLibraryEmbeddings::MODEL: OpenAI embedding model name
#   - CareerLibraryEmbeddings::DIMENSIONS: vector size (must match the library_embeddings column)
module CareerLibraryEmbeddings
  MODEL = ENV.fetch("EMBEDDING_MODEL", "text-embedding-3-small").freeze
  DIMENSIONS = 1536
end

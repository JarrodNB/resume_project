# Description: The embedding of one career library entry's text (derived data: rebuilt by
# CareerLibrary::SyncLibraryEmbeddingsService, read by the AI worker for similarity search).
# `source_type` / `source_id` point at the entry; there is no foreign key, so the sync deletes rows
# whose entry is gone.
# Index:
#   - SOURCE_TYPES: the library models that get embeddings
#   - embedding: 1536-dimension vector (nearest_neighbors via neighbor)
class LibraryEmbedding < ApplicationRecord
  SOURCE_TYPES = %w[Experience ExperienceHighlight Project Education Certification Skill].freeze

  belongs_to :user

  has_neighbors :embedding, dimensions: CareerLibraryEmbeddings::DIMENSIONS

  self.filter_attributes += [ :embedding ]

  validates :source_type, inclusion: { in: SOURCE_TYPES }
  validates :source_id, :content, :content_digest, :model, presence: true
end

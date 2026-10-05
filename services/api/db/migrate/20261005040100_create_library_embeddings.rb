# Description: One embedding per career library entry (experience, highlight, project, education,
# skill), kept in sync by CareerLibrary::SyncLibraryEmbeddingsService. The digest lets a sync skip
# entries whose text and model haven't changed; the HNSW index serves cosine similarity search.
class CreateLibraryEmbeddings < ActiveRecord::Migration[8.1]
  def change
    create_table :library_embeddings, id: :uuid do |t|
      t.references :user, type: :uuid, null: false, foreign_key: { on_delete: :cascade }
      t.string :source_type, null: false
      t.uuid :source_id, null: false
      t.text :content, null: false
      t.string :content_digest, null: false
      t.string :model, null: false
      t.vector :embedding, limit: 1536, null: false
      t.timestamps
      t.index [ :source_type, :source_id ], unique: true
      t.index :embedding, using: :hnsw, opclass: :vector_cosine_ops
    end
  end
end

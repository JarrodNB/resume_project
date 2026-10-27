# Description: Brings a user's library_embeddings in line with their career library: embeds entries
# that are new or whose masked text (or embedding model) changed, and deletes embeddings of entries
# that are gone. The API receives placeholders for the user's known name, contact email, and phone;
# the stored text stays original. Unchanged entries cost nothing, so it is safe to run after every
# library change, twice, or as a backfill. A per-user advisory lock stops two syncs from writing
# over each other.
# Index:
#   - call: syncs under the lock; returns { embedded:, deleted: } counts
module CareerLibrary
  class SyncLibraryEmbeddingsService < ApplicationService
    # @param embedding_client [#embed_texts, #model] Embeddings::OpenAiEmbeddingClient or a test double
    def initialize(user:, embedding_client: nil)
      @user = user
      @embedding_client = embedding_client || Embeddings::OpenAiEmbeddingClient.new(user: user, purpose: "career_library")
    end

    # Reads the library, embeds what changed, and deletes what's gone, inside one locked transaction.
    def call
      ActiveRecord::Base.transaction do
        lock_user_embeddings
        entries = BuildEmbeddingTextsService.call(user: @user).value
        embedded = embed_changed_entries(entries)
        deleted = delete_orphaned_embeddings(entries)
        success({ embedded: embedded, deleted: deleted })
      end
    end

    private

    # Waits for any other sync of this user; released when the transaction ends.
    def lock_user_embeddings
      key = "library_embeddings:#{@user.id}"
      ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(hashtext(#{ActiveRecord::Base.connection.quote(key)}))")
    end

    # Embeds entries whose digest differs from the stored one and upserts them; returns the count.
    def embed_changed_entries(entries)
      stored_digests = @user.library_embeddings.pluck(:source_type, :source_id, :content_digest)
                            .to_h { |type, id, digest| [ [ type, id ], digest ] }
      changed = entries.reject { |entry| stored_digests[entry_key(entry)] == digest_of(entry) }
      return 0 if changed.empty?

      vectors = @embedding_client.embed_texts(changed.map { |entry| outbound_content(entry) })
      rows = changed.zip(vectors).map { |entry, vector| row_for(entry, vector) }
      LibraryEmbedding.upsert_all(rows, unique_by: [ :source_type, :source_id ])
      changed.size
    end

    # Deletes the user's embeddings whose entry no longer exists; returns the count.
    def delete_orphaned_embeddings(entries)
      current_keys = entries.to_set { |entry| entry_key(entry) }
      orphan_ids = @user.library_embeddings.pluck(:id, :source_type, :source_id)
                        .reject { |_id, type, source_id| current_keys.include?([ type, source_id ]) }
                        .map(&:first)
      orphan_ids.empty? ? 0 : LibraryEmbedding.where(id: orphan_ids).delete_all
    end

    # The attributes upserted for one embedded entry.
    def row_for(entry, vector)
      entry.merge(user_id: @user.id, content_digest: digest_of(entry), model: @embedding_client.model, embedding: vector)
    end

    # [source_type, source_id] identifying an entry.
    def entry_key(entry)
      [ entry[:source_type], entry[:source_id] ]
    end

    # The text sent to the embeddings API. Stored content stays original.
    def outbound_content(entry)
      Embeddings::MaskContact.mask(entry[:content], @user)
    end

    # SHA-256 of the model and the masked text, so a contact or model change re-embeds.
    def digest_of(entry)
      Digest::SHA256.hexdigest("#{@embedding_client.model}\n#{outbound_content(entry)}")
    end
  end
end

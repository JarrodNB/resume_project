# Description: Backfills career library embeddings for every user (after enabling embeddings or
# changing the embedding model). Only new or changed entries are embedded, so re-running is cheap.
# Index:
#   - career_library:sync_embeddings: runs CareerLibrary::SyncLibraryEmbeddingsService per user
namespace :career_library do
  desc "Embed new or changed career library entries for every user and delete stale embeddings"
  task sync_embeddings: :environment do
    abort "OPENAI_API_KEY isn't set" unless Embeddings::OpenAiEmbeddingClient.configured?

    User.find_each do |user|
      counts = CareerLibrary::SyncLibraryEmbeddingsService.call(user: user).value
      puts "#{user.id}: embedded #{counts[:embedded]}, deleted #{counts[:deleted]}"
    end
  end
end

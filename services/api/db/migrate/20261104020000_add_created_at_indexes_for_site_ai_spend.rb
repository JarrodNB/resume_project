# Lets the site-wide daily AI spend check read only today's rows instead of scanning all history.
# Built concurrently so sign-ins and AI work keep writing to these tables during the deploy.
# Reissued under a unique version: the old shared version may represent either migration.
class AddCreatedAtIndexesForSiteAiSpend < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_index :ai_tasks, :created_at, algorithm: :concurrently, if_not_exists: true
    add_index :ai_embedding_requests, :created_at, algorithm: :concurrently, if_not_exists: true
  end
end

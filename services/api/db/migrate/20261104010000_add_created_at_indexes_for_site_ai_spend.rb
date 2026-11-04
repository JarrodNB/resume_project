# Lets the site-wide daily AI spend check read only today's rows instead of scanning all history.
# Built concurrently so sign-ins and AI work keep writing to these tables during the deploy.
class AddCreatedAtIndexesForSiteAiSpend < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_index :ai_tasks, :created_at, algorithm: :concurrently
    add_index :ai_embedding_requests, :created_at, algorithm: :concurrently
  end
end

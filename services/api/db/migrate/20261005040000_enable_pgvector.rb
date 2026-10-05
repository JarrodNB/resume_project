# Description: Enables the pgvector extension (shipped in the pgvector/pgvector Postgres image
# locally; available on RDS) for career library embeddings.
class EnablePgvector < ActiveRecord::Migration[8.1]
  def change
    enable_extension "vector"
  end
end

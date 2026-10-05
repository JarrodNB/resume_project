# Description: The read-only database access of the AI worker's `ai_reader` role. Only the tables
# and columns listed here are readable; adding a table to the worker's reach is a deliberate edit.
# Grants live here (applied by `bin/rails db:grant_ai_reader_access`, which runs after db:prepare,
# db:migrate, and db:schema:load) because schema.rb doesn't record them.
# Index:
#   - ROLE_NAME / READABLE_TABLES / READABLE_USER_COLUMNS: what the worker may read
#   - role_exists?: whether the role exists in this Postgres cluster
#   - grant: revokes every other privilege and grants exactly the allowed ones
module AiReaderAccess
  ROLE_NAME = "ai_reader".freeze
  READABLE_TABLES = %w[
    jobs experiences experience_highlights projects educations skills library_facts library_embeddings
  ].freeze
  READABLE_USER_COLUMNS = %w[id summary].freeze

  module_function

  # Whether the ai_reader role exists (roles are created outside Rails: init SQL, Terraform).
  def role_exists?(connection)
    connection.select_value("SELECT 1 FROM pg_roles WHERE rolname = #{connection.quote(ROLE_NAME)}").present?
  end

  # Resets ai_reader to SELECT on READABLE_TABLES plus READABLE_USER_COLUMNS of users.
  def grant(connection)
    role = connection.quote_column_name(ROLE_NAME)
    tables = READABLE_TABLES.map { |table| connection.quote_table_name(table) }.join(", ")
    user_columns = READABLE_USER_COLUMNS.map { |column| connection.quote_column_name(column) }.join(", ")

    connection.transaction do
      connection.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM #{role}")
      connection.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM #{role}")
      connection.execute("GRANT USAGE ON SCHEMA public TO #{role}")
      connection.execute("GRANT SELECT ON #{tables} TO #{role}")
      connection.execute("GRANT SELECT (#{user_columns}) ON users TO #{role}")
    end
  end
end

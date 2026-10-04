# Description: Applies the AI worker's read-only grants (AiReaderAccess) to the primary database.
# Runs automatically after db:prepare, db:migrate, and db:schema:load; skipped when the
# ai_reader role doesn't exist. Run by hand with `bin/rails db:grant_ai_reader_access`.
# Index:
#   - db:grant_ai_reader_access: grants exactly AiReaderAccess's tables and columns to ai_reader
namespace :db do
  desc "Grant the ai_reader role read access to the tables the AI worker needs"
  task grant_ai_reader_access: :environment do
    connection = ActiveRecord::Base.connection
    if AiReaderAccess.role_exists?(connection)
      AiReaderAccess.grant(connection)
      puts "Granted #{AiReaderAccess::ROLE_NAME} read access to #{connection.current_database}"
    else
      puts "Role #{AiReaderAccess::ROLE_NAME} doesn't exist, skipping its grants"
    end
  end
end

%w[db:prepare db:migrate db:schema:load].each do |task_name|
  Rake::Task[task_name].enhance { Rake::Task["db:grant_ai_reader_access"].invoke }
end

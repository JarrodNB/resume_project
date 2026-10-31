# Exercises the real rename in both directions with linked records and resumable AI work.
require "rails_helper"
require Rails.root.join("db/migrate/20261028090000_rename_library_facts_to_career_contexts")

RSpec.describe RenameLibraryFactsToCareerContexts do
  let(:migration) { described_class.new }
  let(:connection) { ActiveRecord::Base.connection }

  def migrate(direction)
    ActiveRecord::Migration.suppress_messages { migration.migrate(direction) }
    connection.schema_cache.clear!
  end

  it "preserves identities, linked answers, vectors, approvals and exact prose through a round trip" do
    user = create(:user)
    context = create(:career_context, user: user, response: 'Facts and library_fact are my exact words.', screened_fields: %w[response])
    answer = create(:job_gap_response, job: create(:job, user: user), career_context: context)
    embedding = create(:library_embedding, user: user, source_type: "CareerContext", source_id: context.id)
    # Exercise the historical schema explicitly; current models ignore this column.
    connection.add_column :interview_sessions, :frozen_context, :jsonb, default: {}, null: false
    interview = user.interview_sessions.create!(expires_at: 1.day.from_now)
    old_source = { "sources" => [ { "type" => "career_contexts", "id" => context.id,
      "field" => "response", "text" => context.response, "screened" => true } ] }
    connection.execute("UPDATE interview_sessions SET frozen_context = #{connection.quote(old_source.to_json)} WHERE id = '#{interview.id}'")
    original_vector = connection.select_value("SELECT embedding::text FROM library_embeddings WHERE id = '#{embedding.id}'")
    migrate(:down)
    expect(connection.table_exists?(:library_facts)).to be(true)
    expect(JSON.parse(connection.select_value("SELECT frozen_context FROM interview_sessions WHERE id = '#{interview.id}'")).dig("sources", 0, "type")).to eq("library_facts")
    expect(connection.select_value("SELECT library_fact_id FROM job_gap_responses WHERE id = '#{answer.id}'")).to eq(context.id)
    legacy_input = {
      "section" => "facts", "library" => { "facts" => [ { "id" => context.id, "response" => context.response } ] },
      "target" => { "kind" => "library_fact", "record_id" => context.id, "source_digest" => "unchanged" },
      "receipt" => { "record_type" => "library_fact" },
      "feedback" => "facts", "history" => [ { "content" => 'library_fact facts LibraryFact' } ]
    }
    task = create(:ai_task, user: user, task_type: "improve_library_entry", input: legacy_input,
      result: { "evidence" => [ { "kind" => "fact", "id" => context.id, "text" => context.response } ] })
    migrate(:up)
    expect(connection.table_exists?(:library_facts)).to be(false)
    expect(context.reload.response).to eq('Facts and library_fact are my exact words.')
    expect(context.screened_fields).to eq(%w[response])
    expect(answer.reload.career_context_id).to eq(context.id)
    source = JSON.parse(connection.select_value("SELECT frozen_context FROM interview_sessions WHERE id = '#{interview.id}'")).fetch("sources").first
    expect(source).to include("type" => "career_contexts", "id" => context.id,
      "text" => context.response, "screened" => true)
    expect(embedding.reload.source_type).to eq("CareerContext")
    expect(connection.select_value("SELECT embedding::text FROM library_embeddings WHERE id = '#{embedding.id}'")).to eq(original_vector)
    input = task.reload.input
    expect(input.dig("receipt", "record_type")).to eq("career_context")
    expect(input["section"]).to eq("career_contexts")
    expect(input.dig("library", "career_contexts", 0, "id")).to eq(context.id)
    expect(input["target"]).to eq(legacy_input["target"].merge("kind" => "career_context"))
    expect(input.values_at("feedback", "history")).to eq(legacy_input.values_at("feedback", "history"))
    expect(task.result.dig("evidence", 0, "kind")).to eq("career_context")
    migrate(:down)
    expect(task.reload.input).to eq(legacy_input)
    expect(task.result.dig("evidence", 0, "kind")).to eq("fact")
    migrate(:up)
    context.destroy!
    expect(answer.reload.career_context_id).to be_nil
  end
end

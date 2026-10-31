# Runs column retirement around real canonical dialogue and accepted legacy receipts.
require "rails_helper"
require Rails.root.join("db/migrate/20261031010000_remove_obsolete_interview_execution_copies")

RSpec.describe RemoveObsoleteInterviewExecutionCopies do
  it "works before and after removal without changing canonical work, fences or accounting" do
    connection = ActiveRecord::Base.connection
    migration = described_class.new
    ActiveRecord::Migration.suppress_messages { migration.migrate(:down) }
    connection.schema_cache.clear!
    interview = Interviews::CreateFixtureService.call(user: create(:user)).value
    interview.update!(career_focus: "Engineering")
    question = interview.questions.first
    expect(interview).not_to respond_to(:frozen_context)
    expect(question).not_to respond_to(:model_history, :history_version)
    operation = Interviews::SubmitTurnService.call(interview: interview, question_id: question.id,
      expected_revision: 0, submission_key: "migration", transcription_mode: "typed", candidate_transcript: "My exact answer").value
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    input = { operation: operation, **claim.slice(:attempt_id, :claim_generation), transcript: "My exact answer",
      decision: "continue", reply: "What changed?", history_version: 1, model_history: [] }
    expect(Interviews::AcceptTurnService.call(**input)).to be_success
    expect(AiTasks::RecordAttemptUsageService.call(ai_task: operation.ai_task, message: {
      "attempt_id" => claim[:attempt_id], "usage" => [ { "model" => "offline-test", "input_tokens" => 12, "output_tokens" => 5, "cost_microdollars" => 123 } ] })).to be_success
    expect(operation.ai_task.reload.cost_microdollars).to eq(123)
    # Retained accepted legacy receipts still fingerprint their original bounded payload.
    legacy = input.merge(model_history: [ { "private" => "old copied source" } ])
    normalize = ->(value) do
      case value
      when Hash then value.stringify_keys.sort.to_h.transform_values { |child| normalize.call(child) }
      when Array then value.map { |child| normalize.call(child) }
      else value
      end
    end
    operation.update!(result_fingerprint: Digest::SHA256.hexdigest(JSON.generate(normalize.call(legacy.except(:operation)))))
    receipt = operation.accepted_result
    connection.execute("UPDATE interview_session_questions SET model_history = '[{\"old\":\"copy\"}]'::jsonb WHERE id = '#{question.id}'")
    tables = %w[interview_sessions interview_session_questions interview_session_messages interview_session_operations interview_execution_attempts ai_tasks ai_usage_attempts]
    retained = -> do
      tables.to_h do |table|
        rows = connection.select_all("SELECT * FROM #{table} ORDER BY id").to_a
        [ table, rows.map { |row| row.except("frozen_context", "model_history", "history_version") } ]
      end
    end
    before = retained.call
    ActiveRecord::Migration.suppress_messages { migration.migrate(:up) }
    connection.schema_cache.clear!
    expect(retained.call).to eq(before)
    expect(connection.column_exists?(:interview_sessions, :frozen_context)).to be(false)
    expect(connection.columns(:interview_session_questions).map(&:name)).not_to include("model_history", "history_version")
    expect(Interviews::AcceptTurnService.call(**legacy).value).to eq(receipt)
    expect(retained.call).to eq(before)
    expect(interview.reload.career_focus).to eq("Engineering")
    expect(interview.messages.answer.pluck(:content)).to eq([ "My exact answer" ])
  ensure
    connection&.schema_cache&.clear!
  end
end

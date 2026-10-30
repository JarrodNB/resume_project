# Description: The ai_reader role can read only the tables and user columns the AI worker needs.
# Everything runs inside the spec's transaction (grants and SET ROLE roll back with it).
# Index:
#   - reader grants: allowed library reads and denial of private interview vectors
require "rails_helper"

RSpec.describe AiReaderAccess do
  let(:connection) { ActiveRecord::Base.connection }

  before do
    connection.execute("CREATE ROLE ai_reader NOLOGIN") unless described_class.role_exists?(connection)
    described_class.grant(connection)
  end

  # Runs a query as ai_reader inside a savepoint, so the role switch (and any error) is undone.
  def select_as_ai_reader(sql)
    rows = nil
    connection.transaction(requires_new: true) do
      connection.execute("SET LOCAL ROLE ai_reader")
      rows = connection.select_all(sql).to_a
      raise ActiveRecord::Rollback
    end
    rows
  end

  it "reads the job and career library tables" do
    job = create(:job)
    create(:experience_highlight)

    expect(select_as_ai_reader("SELECT id FROM jobs")).to eq([ { "id" => job.id } ])
    expect(select_as_ai_reader("SELECT content FROM experience_highlights").size).to eq(1)
  end

  it "reads career library embeddings and career context entries" do
    embedding = create(:library_embedding)
    context = create(:career_context)

    expect(select_as_ai_reader("SELECT id FROM library_embeddings")).to eq([ { "id" => embedding.id } ])
    expect(select_as_ai_reader("SELECT id FROM career_contexts")).to eq([ { "id" => context.id } ])
  end

  it "reads the profile name, contact email, and phone, and not the sign-in email or password" do
    user = create(:user, name: "Ada Lovelace", contact_email: "ada@example.com", phone: "555-0100", summary: "Backend engineer")

    expect(select_as_ai_reader("SELECT id, summary, name, contact_email, phone FROM users")).to eq(
      [ { "id" => user.id, "summary" => "Backend engineer", "name" => "Ada Lovelace", "contact_email" => "ada@example.com", "phone" => "555-0100" } ]
    )
    expect(select_as_ai_reader("SELECT screened_fields FROM users")).to eq([ { "screened_fields" => "{}" } ])
    expect { select_as_ai_reader("SELECT email FROM users") }
      .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    expect { select_as_ai_reader("SELECT encrypted_password FROM users") }
      .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end

  it "cannot read the JWT denylist or unrelated gap-response metadata" do
    create(:job_gap_response)

    expect { select_as_ai_reader("SELECT explanation FROM interview_clarifications") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    expect { select_as_ai_reader("SELECT id FROM jwt_denylists") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    expect { select_as_ai_reader("SELECT updated_at FROM job_gap_responses") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end

  it "exposes only completed job comparisons through the tailoring projection" do
    job = create(:job)
    completed = create(:ai_task, user: job.user, subject: job, task_type: "analyze_gaps",
      status: "completed", result: { "gap_analysis" => { "summary" => "Generated" }, "private" => "Hidden" })
    create(:ai_task, user: job.user, subject: job, task_type: "analyze_gaps", status: "queued")
    create(:ai_task, user: job.user, subject: job, task_type: "tailor_resume", status: "completed")
    rows = select_as_ai_reader("SELECT id, gap_analysis FROM completed_gap_analysis_sources")
    expect(rows).to eq([{ "id" => completed.id, "gap_analysis" => '{"summary": "Generated"}' }])
    expect { select_as_ai_reader("SELECT result FROM completed_gap_analysis_sources") }
      .to raise_error(ActiveRecord::StatementInvalid)
  end

  it "reads only shared catalogue identity and payload, never search pages" do
    listing = create(:job_board_listing)
    expect(select_as_ai_reader("SELECT id, payload FROM job_board_listings").sole["id"]).to eq(listing.id)
    expect { select_as_ai_reader("SELECT provider_id FROM job_board_listings") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    expect { select_as_ai_reader("UPDATE job_board_listings SET payload = '{}' RETURNING id") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    expect { select_as_ai_reader("SELECT id FROM job_board_search_pages") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end

  it "reads confirmed preference sources and receipts without drafts or write access" do
    expect(select_as_ai_reader("SELECT id, user_id, confirmed_revision, confirmed_criteria, screened_criteria_sha256 FROM job_preference_profiles")).to eq([])
    expect(select_as_ai_reader("SELECT screened_sha256 FROM job_board_listings")).to eq([])
    %w[draft_criteria version].each do |column|
      expect { select_as_ai_reader("SELECT #{column} FROM job_preference_profiles") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    end
    expect { select_as_ai_reader("UPDATE job_preference_profiles SET confirmed_criteria = '[]'") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end

  it "reads only the task command and identity columns" do
    task = create(:ai_task, input: { "job_id" => "synthetic-job" })
    expect(select_as_ai_reader("SELECT id, user_id, task_type, status, input FROM ai_tasks").sole)
      .to include("id" => task.id, "task_type" => task.task_type, "status" => "queued")
    %w[result message_history error_message cost_microdollars].each do |column|
      expect { select_as_ai_reader("SELECT #{column} FROM ai_tasks") }
        .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    end
    expect { select_as_ai_reader("UPDATE ai_tasks SET status = 'failed'") }
      .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end

  it "reads only summary-required resume columns and narrowly projected accepted prose" do
    resume = create(:resume)
    section = create(:resume_section, resume: resume, section_type: "experience", content: { "items" => [] })
    accepted = create(:ai_task, user: resume.user, task_type: "tailor_resume", status: "completed", accepted_at: Time.current,
      result: { "sections" => [ { "section_type" => "experience", "content" => { "items" => [ { "highlights" => [ "Generated prose" ] } ] } } ], "private" => "Never exposed" })
    expect(select_as_ai_reader("SELECT id, user_id FROM resumes").sole).to include("id" => resume.id)
    expect(select_as_ai_reader("SELECT id, resume_id, section_type, content, position FROM resume_sections").sole).to include("id" => section.id)
    expect(select_as_ai_reader("SELECT user_id, prose FROM ai_accepted_resume_prose")).to eq([ { "user_id" => accepted.user_id, "prose" => "Generated prose" } ])
    %w[title job_id include_summary].each do |column|
      expect { select_as_ai_reader("SELECT #{column} FROM resumes") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    end
    expect { select_as_ai_reader("SELECT result FROM ai_tasks") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    expect { select_as_ai_reader("UPDATE resume_sections SET content = '{}'::jsonb") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end

  it "reads interview execution inputs but hides private history, legacy sources and media" do
    expect(select_as_ai_reader("SELECT id, preparation_kind FROM interview_sessions")).to eq([])
    expect(select_as_ai_reader("SELECT attempt_id, claim_generation FROM interview_session_operations")).to eq([])
    { "interview_sessions" => %w[frozen_context], "interview_session_questions" => %w[model_history],
      "interview_session_operations" => %w[accepted_result result_fingerprint],
      "interview_session_media" => %w[staging_key sealed_key] }.each do |table, columns|
      columns.each do |column|
        expect { select_as_ai_reader("SELECT #{column} FROM #{table}") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
      end
    end
  end

  it "reads only required generation and feedback sources from written practice records" do
    expect(select_as_ai_reader("SELECT id, user_id, number, set_type, created_at FROM interview_question_sets")).to eq([])
    expect(select_as_ai_reader("SELECT id, interview_question_set_id, question_text, question_revision, answer_revision, position, retired_at, answer_text, screened_fields FROM interview_questions")).to eq([])
    expect(select_as_ai_reader("SELECT id, user_id, question_text, created_at FROM avoided_interview_questions")).to eq([])
    %w[feedback feedback_answer_revision feedback_question_revision].each do |column|
      expect { select_as_ai_reader("SELECT #{column} FROM interview_questions") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    end
    expect { select_as_ai_reader("UPDATE interview_questions SET question_text = 'changed'") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end

  it "keeps provider attempts and accounting outside written practice source access" do
    %w[interview_provider_attempts interview_execution_attempts chat_provider_attempts
       chat_execution_attempts ai_usage_attempts ai_usage_reconciliations].each do |table|
      expect { select_as_ai_reader("SELECT id FROM #{table}") }
        .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    end
  end

  it "reads auxiliary claim fences without exposing saved coaching or reference results" do
    %w[interview_clarifications interview_career_references interview_session_feedbacks].each do |table|
      expect(select_as_ai_reader("SELECT id, ai_task_id, claimed_at, deadline FROM #{table}")).to eq([])
    end
    { "interview_clarifications" => "explanation", "interview_career_references" => "references",
      "interview_session_feedbacks" => "content" }.each do |table, column|
      expect { select_as_ai_reader("SELECT #{ActiveRecord::Base.connection.quote_column_name(column)} FROM #{table}") }
        .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    end
  end

  it "reads narrow chat inputs but hides private execution results and feedback" do
    expect(select_as_ai_reader("SELECT id, summary_version, summary_through_position FROM chat_conversations")).to eq([])
    expect(select_as_ai_reader("SELECT message, expected_position, summary_base_version, summary_plan FROM chat_operations")).to eq([])
    expect(select_as_ai_reader("SELECT position, role, content, screened_sha256 FROM chat_messages")).to eq([])
    { "chat_conversations" => %w[title], "chat_operations" => %w[accepted_result result_fingerprint],
      "chat_messages" => %w[thumbs_up thumbs_down] }.each do |table, columns|
      columns.each do |column|
        expect { select_as_ai_reader("SELECT #{column} FROM #{table}") }
          .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
      end
    end
  end

  it "can't write" do
    create(:job)

    expect { select_as_ai_reader("UPDATE jobs SET title = 'x' RETURNING id") }
      .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end

  it "cannot read account confirmation state or secrets" do
    %w[confirmation_token confirmed_at confirmation_sent_at unconfirmed_email reset_password_token reset_password_sent_at].each do |column|
      expect { select_as_ai_reader("SELECT #{column} FROM users") }
        .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    end
  end
  it "reads independent certifications but cannot modify them" do
    credential = create(:certification)
    expect(select_as_ai_reader("SELECT id, name FROM certifications")).to eq([ { "id" => credential.id, "name" => credential.name } ])
    expect { select_as_ai_reader("UPDATE certifications SET name = 'Changed'") }
      .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end
  it "exposes only generated library exchange fields through a read-only workflow view" do
    edit = create(:ai_task, task_type: "improve_library_entry", result: { "text" => "Generated proposal" },
      message_history: [{ "kind" => "response", "parts" => [] }])
    create(:ai_task, task_type: "analyze_gaps", result: { "private" => "Other workflow result" })
    rows = select_as_ai_reader("SELECT id, result, message_history FROM ai_library_exchanges")
    expect(rows.map { |row| row["id"] }).to eq([edit.id])
    expect { select_as_ai_reader("SELECT cost_microdollars FROM ai_library_exchanges") }
      .to raise_error(ActiveRecord::StatementInvalid, /does not exist/)
    expect { select_as_ai_reader("SELECT encrypted_password FROM ai_library_exchanges") }
      .to raise_error(ActiveRecord::StatementInvalid, /does not exist/)
    expect { select_as_ai_reader("UPDATE ai_library_exchanges SET status = 'failed'") }
      .to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end
end

RSpec.describe "Interview embedding access" do
  it "keeps Q&A vectors outside the AI reader role" do
    connection = ActiveRecord::Base.connection
    connection.execute("CREATE ROLE ai_reader NOLOGIN") unless AiReaderAccess.role_exists?(connection)
    AiReaderAccess.grant(connection)
    expect do
      connection.transaction(requires_new: true) do
        connection.execute("SET LOCAL ROLE ai_reader")
        connection.select_all("SELECT content FROM interview_question_embeddings")
      end
    end.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end


end

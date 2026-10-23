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
    role = create(:experience).roles.first
    expect(select_as_ai_reader("SELECT id FROM experience_roles")).to eq([ { "id" => role.id } ])

    expect(select_as_ai_reader("SELECT id FROM jobs")).to eq([ { "id" => job.id } ])
    expect(select_as_ai_reader("SELECT content FROM experience_highlights").size).to eq(1)
  end

  it "reads career library embeddings and library facts" do
    embedding = create(:library_embedding)
    fact = create(:library_fact)

    expect(select_as_ai_reader("SELECT id FROM library_embeddings")).to eq([ { "id" => embedding.id } ])
    expect(select_as_ai_reader("SELECT id FROM library_facts")).to eq([ { "id" => fact.id } ])
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

  it "can't read AI tasks, the JWT denylist, or job-only gap responses" do
    create(:job_gap_response)

    expect { select_as_ai_reader("SELECT id FROM interview_clarifications") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    expect { select_as_ai_reader("SELECT id FROM ai_tasks") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    expect { select_as_ai_reader("SELECT id FROM jwt_denylists") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    expect { select_as_ai_reader("SELECT id FROM job_gap_responses") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
  end

  it "cannot read shared job board catalogue or search pages" do
    expect { select_as_ai_reader("SELECT id FROM job_board_listings") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
    expect { select_as_ai_reader("SELECT id FROM job_board_search_pages") }.to raise_error(ActiveRecord::StatementInvalid, /permission denied/)
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

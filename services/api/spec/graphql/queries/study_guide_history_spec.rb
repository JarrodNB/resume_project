# Exercises owned guide history and selected content through GraphQL, including stable continuation.
require "rails_helper"

RSpec.describe "Study guide history" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user, description: "Reconcile stock counts.") }
  let(:history_query) { 'query($jobId: ID!, $cursor: String) { job(id: $jobId) { studyGuides(cursor: $cursor) { guides { id createdAt } nextCursor errors } } }' }

  def guide(at:, **attributes)
    create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "completed",
      created_at: at, result: { study_guide: { title: "Inventory" } }, **attributes)
  end

  def history(cursor: nil, job_id: job.id, owner: user)
    execute_graphql(history_query, user: owner, variables: { jobId: job_id, cursor: cursor })
  end

  it "returns only successful guide summaries newest first without guide bodies" do
    first = guide(at: 3.minutes.ago)
    second = guide(at: 2.minutes.ago)
    guide(at: 1.minute.ago, status: "failed")
    guide(at: Time.current, task_type: "analyze_gaps")
    response = history
    expect(response["errors"]).to be_nil
    expect(response.dig("data", "job", "studyGuides", "guides").map { |item| item["id"] }).to eq([ second.id, first.id ])
    expect(response.dig("data", "job", "studyGuides", "guides").first.keys).to match_array(%w[id createdAt])
  end

  it "continues without missing or repeating entries when a newer guide arrives" do
    old = Array.new(7) { |i| guide(at: Time.current - (i + 1).minutes) }
    first = history.dig("data", "job", "studyGuides")
    expect(first["guides"].map { |item| item["id"] }).to eq(old.first(5).map(&:id))
    newer = guide(at: Time.current)
    second = history(cursor: first["nextCursor"]).dig("data", "job", "studyGuides")
    expect(second["guides"].map { |item| item["id"] }).to eq(old.last(2).map(&:id))
    expect(second["nextCursor"]).to be_nil
    expect(history.dig("data", "job", "studyGuides", "guides").first["id"]).to eq(newer.id)
  end

  it "orders equal timestamps by id so continuation is deterministic" do
    time = Time.current
    saved = Array.new(6) { guide(at: time) }.sort_by(&:id).reverse
    first = history.dig("data", "job", "studyGuides")
    second = history(cursor: first["nextCursor"]).dig("data", "job", "studyGuides")
    ids = [ *first["guides"], *second["guides"] ].map { |item| item["id"] }
    expect(ids).to eq(saved.map(&:id))
  end

  it "rejects another account's job and cursors from another job or invalid tokens" do
    expect(history(owner: create(:user))["errors"].first["message"]).to eq("Record not found")
    6.times { |i| guide(at: i.minutes.ago) }
    cursor = history.dig("data", "job", "studyGuides", "nextCursor")
    other_job = create(:job, user: user)
    expect(history(cursor: cursor, job_id: other_job.id).dig("data", "job", "studyGuides", "errors")).to include(/Invalid guide history cursor/)
    expect(history(cursor: "malformed").dig("data", "job", "studyGuides", "errors")).to include(/Invalid guide history cursor/)
  end

  it "reads selected successful guide content only through its owned job" do
    saved = guide(at: Time.current)
    query = 'query($jobId: ID!, $id: ID!) { job(id: $jobId) { studyGuide(id: $id) { id result } } }'
    read = ->(job_id, guide_id, owner = user) { execute_graphql(query, user: owner, variables: { jobId: job_id, id: guide_id }) }
    expect(read.call(job.id, saved.id).dig("data", "job", "studyGuide", "result")).to eq(saved.result)
    expect(read.call(job.id, saved.id, create(:user))["errors"].first["message"]).to eq("Record not found")
    expect(read.call(create(:job, user: user).id, saved.id)["errors"].first["message"]).to eq("Record not found")
    failed = guide(at: Time.current, status: "failed")
    expect(read.call(job.id, failed.id)["errors"].first["message"]).to eq("Record not found")
  end
end

# Exercises a job's ordered question collection through its owned GraphQL interface.
require "rails_helper"

RSpec.describe "Study question collection" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user, description: "Count stock.") }
  let(:query) { 'query($id: ID!, $cursor: String) { job(id: $id) { studyQuestionBatches(cursor: $cursor) { batches { id result outOfDate } endCursor totalQuestions errors } } }' }

  def batch(at: Time.current, **attributes)
    create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "completed", created_at: at,
      input: { description: job.description }, result: { study_guide: { version: 1, title: "Stock", questions: Array.new(5) { |i|
        { question: "How do you count #{i}?", why_it_matters: "Stock accuracy", answer: "Count carefully.", example: "Count 3 units." }
      } } }, **attributes)
  end

  def read(cursor: nil, job_id: job.id, owner: user)
    execute_graphql(query, user: owner, variables: { id: job_id, cursor: cursor })
  end

  it "pages oldest first with stable equal-time cursors and includes newly appended batches" do
    saved = Array.new(3) { batch(at: 1.minute.ago.change(usec: 0)) }.sort_by(&:id)
    first = read.dig("data", "job", "studyQuestionBatches")
    expect(first["batches"].map { |item| item["id"] }).to eq([saved[0].id])
    expect(first["totalQuestions"]).to eq(15)
    newer = batch
    second = read(cursor: first["endCursor"]).dig("data", "job", "studyQuestionBatches")
    expect(second["batches"].map { |item| item["id"] }).to eq([saved[1].id])
    third = read(cursor: second["endCursor"]).dig("data", "job", "studyQuestionBatches")
    fourth = read(cursor: third["endCursor"]).dig("data", "job", "studyQuestionBatches")
    expect(fourth["batches"].first["id"]).to eq(newer.id)
    expect(fourth["totalQuestions"]).to eq(20)
  end

  it "excludes failed, unrelated, legacy and malformed results" do
    valid = batch
    batch(status: "failed")
    batch(task_type: "analyze_gaps")
    batch(result: { study_guide: { title: "Old guide", topics: [] } })
    batch(result: { study_guide: { version: 1, title: "Broken", questions: [ {}, {}, {}, {}, {} ] } })
    page = read.dig("data", "job", "studyQuestionBatches")
    expect(page["totalQuestions"]).to eq(5)
    expect(page["batches"].map { |item| item["id"] }).to eq([valid.id])
  end

  it "scopes jobs and signed cursors, and reflects each batch's own freshness" do
    saved = batch
    first = read.dig("data", "job", "studyQuestionBatches")
    expect(first["batches"].first["outOfDate"]).to be(false)
    job.update!(description: "Different duties.")
    expect(read.dig("data", "job", "studyQuestionBatches", "batches", 0, "outOfDate")).to be(true)
    expect(read(owner: create(:user))["errors"].first["message"]).to eq("Record not found")
    other = create(:job, user: user)
    expect(read(job_id: other.id, cursor: first["endCursor"]).dig("data", "job", "studyQuestionBatches", "errors")).to include(/Invalid question cursor/)
    expect(read(cursor: "bad").dig("data", "job", "studyQuestionBatches", "errors")).to include(/Invalid question cursor/)
  end
end

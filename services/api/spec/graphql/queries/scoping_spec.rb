# Description: Every query only returns the signed-in user's own records.
require "rails_helper"

RSpec.describe "Query scoping" do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }

  it "lists only the user's own jobs, optionally filtered by stage" do
    create(:job, user: user, title: "Mine", stage: "applied")
    create(:job, user: user, title: "Mine too")
    create(:job, user: other_user, title: "Theirs")
    create(:job, user: user, title: "Archived", stage: "applied", archived_at: Time.current)

    all_jobs = execute_graphql("{ jobs { title } }", user: user)
    applied_jobs = execute_graphql("{ jobs(stage: APPLIED) { title } }", user: user)

    expect(all_jobs.dig("data", "jobs").map { _1["title"] }).to contain_exactly("Mine", "Mine too")
    expect(applied_jobs.dig("data", "jobs").map { _1["title"] }).to eq([ "Mine" ])
  end

  it "returns 'Record not found' for another user's job" do
    their_job = create(:job, user: other_user)

    result = execute_graphql("query($id: ID!) { job(id: $id) { title } }", user: user, variables: { id: their_job.id })

    expect(result["errors"].first["message"]).to eq("Record not found")
  end

  it "reports the signed-in user's combined general and spoken interview spend" do
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 3_000_000)
    user.update!(monthly_ai_budget_microdollars: 5_000_000)
    create(:ai_task, user: user, cost_microdollars: 1_250_000)
    create(:ai_task, user: other_user, cost_microdollars: 900_000)
    create(:ai_task, user: user, task_type: "interview_turn", cost_microdollars: 700_000)
    create(:ai_task, user: user, task_type: "review_interview_answer", cost_microdollars: 250_000)
    user.ai_embedding_requests.create!(model: "text-embedding-3-small", purpose: "career_library", cost_microdollars: 50_000, finalized: true, incomplete: false)
    unknown = create(:ai_task, user: user, task_type: "interview_turn")
    report = unknown.ai_usage_attempts.create!(attempt_id: SecureRandom.uuid, incomplete: true)
    other_user.ai_embedding_requests.create!(model: "text-embedding-3-small", purpose: "career_library")

    query = "{ me { aiUsage { spentThisMonthUsd monthlyBudgetUsd resetsAt incompleteAttempts accountingComplete } } }"
    result = execute_graphql(query, user: user)

    expect(result.dig("data", "me", "aiUsage")).to include("spentThisMonthUsd" => 2.25, "monthlyBudgetUsd" => 8.0,
      "incompleteAttempts" => 1, "accountingComplete" => false)
    expect(Time.zone.parse(result.dig("data", "me", "aiUsage", "resetsAt"))).to eq(Time.now.utc.beginning_of_month.next_month)
    report.update!(incomplete: false, finalized: true)
    expect(execute_graphql(query, user: user).dig("data", "me", "aiUsage")).to include("incompleteAttempts" => 0, "accountingComplete" => true)
  end

  it "returns experiences with ordered highlights" do
    experience = create(:experience, user: user)
    create(:experience_highlight, experience: experience, content: "Second", position: 1)
    create(:experience_highlight, experience: experience, content: "First", position: 0)

    result = execute_graphql("{ experiences { company highlights { content } } }", user: user)

    expect(result.dig("data", "experiences", 0, "highlights").map { _1["content"] }).to eq([ "First", "Second" ])
  end
end

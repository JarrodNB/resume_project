# Reads freshness from exact saved description snapshots without changing or regenerating guides.
require "rails_helper"

RSpec.describe "Study guide freshness" do
  let(:user) { create(:user) }
  let(:source) { "Reconcile stock counts.\nUse spreadsheets." }
  let(:job) { create(:job, user: user, description: source) }
  let!(:guide) do
    create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "completed",
      input: { "job_id" => job.id, "description" => source }, result: { "study_guide" => { "title" => "Inventory" } })
  end
  let(:query) do
    'query($jobId: ID!, $guideId: ID!) { job(id: $jobId) { studyGuideDescriptionFingerprint studyGuides { guides { id sourceDescriptionFingerprint outOfDate } } studyGuide(id: $guideId) { id result studyGuideOutOfDate } } }'
  end

  def read
    execute_graphql(query, user: user, variables: { jobId: job.id, guideId: guide.id }).dig("data", "job")
  end

  it "marks both history and selected content out of date after edits and current after exact restoration" do
    before = read
    expect(before).not_to be_nil
    expect(before.dig("studyGuides", "guides", 0, "outOfDate")).to be(false)
    expect(before.dig("studyGuide", "studyGuideOutOfDate")).to be(false)
    expect(before.dig("studyGuides", "guides", 0, "sourceDescriptionFingerprint")).to eq(before["studyGuideDescriptionFingerprint"])

    Jobs::UpdateJobService.call(job: job, attributes: { description: source + " " })
    changed = read
    expect(changed.dig("studyGuides", "guides", 0, "outOfDate")).to be(true)
    expect(changed.dig("studyGuide", "studyGuideOutOfDate")).to be(true)
    expect(changed.dig("studyGuide", "result")).to eq(guide.result)
    expect(changed["studyGuideDescriptionFingerprint"]).not_to eq(before["studyGuideDescriptionFingerprint"])
    expect(job.ai_tasks.count).to eq(1)

    Jobs::UpdateJobService.call(job: job, attributes: { description: source })
    restored = read
    expect(restored.dig("studyGuides", "guides", 0, "outOfDate")).to be(false)
    expect(restored.dig("studyGuide", "studyGuideOutOfDate")).to be(false)
    expect(job.ai_tasks.count).to eq(1)
  end

  it "compares every history entry with its own source and preserves exact whitespace and case" do
    other = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "completed",
      input: { "job_id" => job.id, "description" => source.downcase }, result: guide.result)
    entries = read.dig("studyGuides", "guides").index_by { |entry| entry["id"] }
    expect(entries.fetch(guide.id)["outOfDate"]).to be(false)
    expect(entries.fetch(other.id)["outOfDate"]).to be(true)

    Jobs::UpdateJobService.call(job: job, attributes: { description: source.downcase })
    entries = read.dig("studyGuides", "guides").index_by { |entry| entry["id"] }
    expect(entries.fetch(guide.id)["outOfDate"]).to be(true)
    expect(entries.fetch(other.id)["outOfDate"]).to be(false)
    expect(entries.fetch(guide.id)["sourceDescriptionFingerprint"]).not_to eq(entries.fetch(other.id)["sourceDescriptionFingerprint"])
  end

  it "marks retained content stale when description is cleared and blocks new generation" do
    Jobs::UpdateJobService.call(job: job, attributes: { description: nil })
    response = read
    expect(response.dig("studyGuide", "studyGuideOutOfDate")).to be(true)
    expect(response.dig("studyGuide", "result")).to eq(guide.result)
    expect(response.dig("studyGuides", "guides", 0, "outOfDate")).to be(true)
    generation = StudyGuides::StartGuideService.call(user: user, job: job)
    expect(generation).not_to be_success
    expect(generation.errors).to include(/Add a job description/)
    expect(job.ai_tasks.count).to eq(1)
  end
end

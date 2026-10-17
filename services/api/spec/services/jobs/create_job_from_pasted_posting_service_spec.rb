# Description: Saving the Job from a completed parse_job_posting task's ScrapedJobPosting.
require "rails_helper"

RSpec.describe Jobs::CreateJobFromPastedPostingService do
  let(:user) { create(:user) }
  let(:ai_task) { create(:ai_task, user: user, task_type: "parse_job_posting", input: { "text" => "ad" }) }
  let(:scraped_job) do
    {
      "source" => "pasted_text", "source_url" => "https://example.com/jobs/1",
      "title" => "AI Engineer", "company" => "Acme", "location" => "Remote",
      "description" => "Build agents.", "requirements" => [ "Python" ],
      "responsibilities" => [ "Build agents" ], "nice_to_haves" => [ "Rust" ],
      "requirements_sorted_by" => "llm", "warnings" => []
    }
  end

  it "saves an unapplied job with the posting's link" do
    result = described_class.call(ai_task: ai_task, scraped_job: scraped_job)

    expect(result).to be_success
    expect(result.value).to have_attributes(
      user: user, url: "https://example.com/jobs/1", title: "AI Engineer", company: "Acme",
      location: "Remote", description: "Build agents.", requirements: [ "Python" ],
      responsibilities: [ "Build agents" ], nice_to_haves: [ "Rust" ], stage: "unapplied"
    )
  end

  it "stores a blank link as nil and does not reuse another job that has no link" do
    existing_job = create(:job, user: user, url: nil)

    result = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("source_url" => ""))

    expect(result.value).not_to eq(existing_job)
    expect(result.value.url).to be_nil
    expect(user.jobs.count).to eq(2)
  end

  it "returns the user's existing job for the same URL instead of a duplicate" do
    existing_job = create(:job, user: user, url: "https://example.com/jobs/1")

    result = described_class.call(ai_task: ai_task, scraped_job: scraped_job)

    expect(result.value).to eq(existing_job)
    expect(user.jobs.count).to eq(1)
  end

  it "rejects a posting that isn't an object" do
    result = described_class.call(ai_task: ai_task, scraped_job: [ "nope" ])

    expect(result.errors).to eq([ "Pasted job must be an object" ])
  end

  it "saves a missing company as null" do
    result = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("company" => nil))

    expect(result).to be_success
    expect(result.value.reload.company).to be_nil
  end

  it "normalizes blank companies without relaxing the title or text limits" do
    result = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("company" => " \t"))
    expect(result).to be_success
    expect(result.value.reload.company).to be_nil

    missing_title = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("source_url" => nil, "title" => nil))
    expect(missing_title.errors).to include("Title can't be blank")
    oversized = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("source_url" => nil, "company" => "a" * (TextLimits::SHORT + 1)))
    expect(oversized).not_to be_success
  end
end

# Description: Saving the Job from a completed scrape_job task's ScrapedJobPosting.
require "rails_helper"

RSpec.describe Jobs::CreateJobFromScrapedPostingService do
  let(:user) { create(:user) }
  let(:url) { "https://www.linkedin.com/jobs/view/1/" }
  let(:ai_task) { create(:ai_task, user: user, task_type: "scrape_job", input: { "url" => url }) }
  let(:scraped_job) do
    {
      "source" => "linkedin", "source_url" => "https://www.linkedin.com/jobs/view/1/?from=worker",
      "title" => "AI Engineer", "company" => "Acme", "location" => "Remote",
      "description" => "Build agents.", "requirements" => [ "Python" ],
      "responsibilities" => [ "Build agents" ], "nice_to_haves" => [ "Rust" ],
      "requirements_sorted_by" => "headings", "warnings" => []
    }
  end

  it "saves an unapplied job with the task's canonical URL" do
    result = described_class.call(ai_task: ai_task, scraped_job: scraped_job)

    expect(result).to be_success
    expect(result.value).to have_attributes(
      user: user, url: url, title: "AI Engineer", company: "Acme", location: "Remote",
      description: "Build agents.", requirements: [ "Python" ], responsibilities: [ "Build agents" ],
      nice_to_haves: [ "Rust" ], stage: "unapplied"
    )
  end

  it "returns the user's existing job for the same URL instead of a duplicate" do
    existing_job = create(:job, user: user, url: url)

    result = described_class.call(ai_task: ai_task, scraped_job: scraped_job)

    expect(result.value).to eq(existing_job)
    expect(user.jobs.count).to eq(1)
  end

  it "rejects a posting that isn't an object" do
    result = described_class.call(ai_task: ai_task, scraped_job: [ "nope" ])

    expect(result.errors).to eq([ "Scraped job must be an object" ])
  end

  it "rejects fields of the wrong type" do
    result = described_class.call(
      ai_task: ai_task, scraped_job: scraped_job.merge("title" => 5, "requirements" => "Python")
    )

    expect(result.errors).to eq([ "Scraped job title must be text", "Scraped job requirements must be a list of text" ])
    expect(user.jobs).to be_empty
  end

  it "stores a blank company as null" do
    result = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("company" => ""))

    expect(result).to be_success
    expect(result.value.reload.company).to be_nil
  end
end

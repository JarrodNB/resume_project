# Description: Queueing public job URLs, retaining LinkedIn canonicalization and rejecting unsafe inputs.
require "rails_helper"

RSpec.describe Jobs::StartJobScrapingService do
  let(:user) { create(:user) }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }
  let(:canonical_url) { "https://www.linkedin.com/jobs/view/4419969671/" }

  before { allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue) }

  {
    "https://www.linkedin.com/jobs/view/4419969671" => "plain",
    "  https://www.linkedin.com/jobs/view/4419969671/?refId=abc&trackingId=xyz  " => "tracking parameters",
    "https://www.linkedin.com/jobs/view/senior-engineer-go-at-general-motors-4419969671" => "title slug",
    "https://uk.linkedin.com/jobs/view/4419969671" => "country subdomain",
    "https://www.linkedin.com/comm/jobs/view/4419969671/?trk=email" => "email",
    "https://www.linkedin.com/jobs/search/?currentJobId=4419969671&keywords=go" => "search page",
    "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4419969671" => "collection page"
  }.each do |pasted_url, form|
    it "queues the canonical link for a #{form} link" do
      result = described_class.call(user: user, url: pasted_url)

      expect(result).to be_success
      expect(result.value).to be_scrape_job.and be_queued
      expect(result.value.input).to eq("url" => canonical_url)
      expect(queue).to have_received(:send_message)
    end
  end

  [
    "https://www.linkedin.com/jobs/",
    "https://www.linkedin.com/jobs/search/?keywords=go",
    "https://www.linkedin.com/feed/?currentJobId=1",
    "ftp://www.linkedin.com/jobs/view/1",
    "www.linkedin.com/jobs/view/1",
    "not a url at all",
    "http://127.0.0.1/jobs/1",
    "http://169.254.169.254/latest/meta-data/",
    "https://localhost/jobs/1",
    "https://company.local/jobs/1",
    "https://user:password@company.com/jobs/1",
    "https://company.com:8443/jobs/1",
    "https://company.com/" + "x" * 2048
  ].each do |unsupported_url|
    it "rejects #{unsupported_url.inspect}" do
      result = described_class.call(user: user, url: unsupported_url)

      expect(result.errors).to eq([ described_class::UNSUPPORTED_URL_MESSAGE ])
      expect(queue).not_to have_received(:send_message)
    end
  end

  [
    "https://company.com/careers/engineer?jobId=42",
    "https://www.indeed.com/viewjob?jk=abc123",
    "https://boards.greenhouse.io/company/jobs/123",
    "https://company.com/jobs/" + "x" * 250
  ].each do |url|
    it "queues a general public posting URL unchanged" do
      result = described_class.call(user: user, url: url + "#details")
      expect(result).to be_success
      expect(result.value.input).to eq("url" => url)
    end
  end

  it "reuses the same URL identity for generic duplicates" do
    url = "https://company.com/jobs/42?department=Engineering"
    create(:job, user: user, url: url)
    result = described_class.call(user: user, url: url + "#posting")
    expect(result.errors).to eq([ "You already saved this job" ])
    expect(queue).not_to have_received(:send_message)
  end

  it "rejects a job the user already saved, whatever form the link takes" do
    create(:job, user: user, url: canonical_url)

    result = described_class.call(user: user, url: "https://www.linkedin.com/jobs/search/?currentJobId=4419969671")

    expect(result.errors).to eq([ "You already saved this job" ])
    expect(user.ai_tasks).to be_empty
  end

  it "allows a job another user already saved" do
    create(:job, url: canonical_url)

    expect(described_class.call(user: user, url: canonical_url)).to be_success
  end

  it "respects the user's AI usage limits" do
    user.update!(monthly_ai_budget_microdollars: 100)
    create(:ai_task, :completed_resume_parse, user: user, cost_microdollars: 100)

    result = described_class.call(user: user, url: canonical_url)

    expect(result.errors.first).to start_with("You've reached this month's AI usage limit")
    expect(queue).not_to have_received(:send_message)
  end
end

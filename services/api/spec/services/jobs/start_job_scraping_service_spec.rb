# Description: Queueing a scrape_job task for a LinkedIn job link.
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
    "https://www.indeed.com/viewjob?jk=abc123",
    "https://www.linkedin.com/jobs/",
    "https://www.linkedin.com/jobs/search/?keywords=go",
    "https://www.linkedin.com/feed/?currentJobId=1",
    "https://linkedin.com.evil.com/jobs/view/1",
    "ftp://www.linkedin.com/jobs/view/1",
    "www.linkedin.com/jobs/view/1",
    "not a url at all"
  ].each do |unsupported_url|
    it "rejects #{unsupported_url.inspect}" do
      result = described_class.call(user: user, url: unsupported_url)

      expect(result.errors).to eq([ described_class::UNSUPPORTED_URL_MESSAGE ])
      expect(queue).not_to have_received(:send_message)
    end
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

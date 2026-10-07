# Description: Queueing a parse_job_posting task for a pasted job advertisement.
require "rails_helper"

RSpec.describe Jobs::StartJobPostingParseService do
  let(:user) { create(:user) }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }
  let(:ad) { "  AI Engineer at Acme. Required: Python.  " }

  before { allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue) }

  it "queues the pasted ad with surrounding space removed" do
    result = described_class.call(user: user, text: ad)

    expect(result).to be_success
    expect(result.value).to be_parse_job_posting.and be_queued
    expect(result.value.input).to eq("text" => "AI Engineer at Acme. Required: Python.")
    expect(queue).to have_received(:send_message)
  end

  it "rejects a blank paste" do
    result = described_class.call(user: user, text: "   ")

    expect(result.errors).to eq([ described_class::BLANK_MESSAGE ])
    expect(queue).not_to have_received(:send_message)
  end

  it "rejects a paste longer than a job description" do
    result = described_class.call(user: user, text: "a" * (TextLimits::JOB_DESCRIPTION + 1))

    expect(result.errors).to eq([ described_class::TOO_LONG_MESSAGE ])
    expect(user.ai_tasks).to be_empty
  end

  it "respects the user's AI usage limits" do
    user.update!(monthly_ai_budget_microdollars: 100)
    create(:ai_task, :completed_resume_parse, user: user, cost_microdollars: 100)

    result = described_class.call(user: user, text: ad)

    expect(result.errors.first).to start_with("You've reached this month's AI usage limit")
    expect(queue).not_to have_received(:send_message)
  end
end

# Description: Submitting one tailored section requeues the same task at the next generation.
require "rails_helper"

RSpec.describe ResumeTailoring::SubmitTailoredSectionService do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:ai_task) do
    create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "needs_user_input", generation: 1, input: { "generation" => 1, "approved_sections" => [] })
  end
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }

  before do
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    allow(ApiSchema.subscriptions).to receive(:trigger)
  end

  it "stores the edit, increments the generation, and queues the same task" do
    result = described_class.call(
      ai_task: ai_task, section_type: "summary", action: "approve", content: { "text" => "Backend engineer." }
    )

    expect(result).to be_success
    ai_task.reload
    expect(ai_task).to be_queued
    expect(ai_task.generation).to eq(2)
    expect(ai_task.input["generation"]).to eq(2)
    expect(ai_task.input["pending_section"]).to include("action" => "approve", "section_type" => "summary")
    expect(queue).to have_received(:send_message)
  end

  it "leaves out or reopens a section even when the content argument is over the screen cap" do
    content = { "text" => "a" * (TextLimits::SCREENED_TEXT + 1) }

    %w[omit reopen].each do |action|
      task = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "needs_user_input", generation: 1, input: { "generation" => 1, "approved_sections" => [] })

      result = described_class.call(ai_task: task, section_type: "summary", action: action, content: content)

      expect(result).to be_success
      expect(task.reload.input["pending_section"]).to include("action" => action)
    end
  end

  it "refuses a section whose text is over the screen cap" do
    content = { "text" => "a" * (TextLimits::SCREENED_TEXT + 1) }

    result = described_class.call(ai_task: ai_task, section_type: "summary", action: "approve", content: content)

    expect(result.errors).to eq([ TextLimits::SECTION_TOO_LONG ])
    expect(ai_task.reload).to be_needs_user_input
    expect(queue).not_to have_received(:send_message)
  end

  it "refuses when the task is not waiting for an edit" do
    ai_task.update!(status: "queued")

    result = described_class.call(ai_task: ai_task, section_type: "summary", action: "approve", content: { "text" => "Hi" })

    expect(result.errors).to eq([ described_class::NOT_WAITING_MESSAGE ])
    expect(queue).not_to have_received(:send_message)
  end

  it "accepts reopening an earlier section" do
    result = described_class.call(ai_task: ai_task, section_type: "experience", action: "reopen")

    expect(result).to be_success
    expect(ai_task.reload.input["pending_section"]["action"]).to eq("reopen")
  end
end

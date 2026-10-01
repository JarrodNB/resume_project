# Description: The ai_results worker applies valid messages and raises on rejected ones.
require "rails_helper"

RSpec.describe AiResultWorker do
  let(:ai_task) { create(:ai_task) }

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  it "applies a result message" do
    described_class.new.perform(nil, { "ai_task_id" => ai_task.id, "status" => "completed", "result" => {} })

    expect(ai_task.reload).to be_completed
  end

  it "raises for a rejected message so SQS retries it, then dead-letters it" do
    expect { described_class.new.perform(nil, { "ai_task_id" => ai_task.id, "status" => "bogus" }) }
      .to raise_error(ArgumentError, /Unknown result status/)
  end
end

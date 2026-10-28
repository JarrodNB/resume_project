# Run interview retirement from durable Rails maintenance, without HTTP discovery.
require "rails_helper"

RSpec.describe "Scheduled interview cleanup" do
  before do
    allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: true, errors: []))
    allow(Interviews::MediaStorage).to receive(:new).and_return(instance_double(Interviews::MediaStorage, delete: nil))
  end

  it "expires stale owned work and retains its usage ledger" do
    interview = Interviews::CreateFixtureService.call(user: create(:user)).value
    operation = interview.operations.first
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
    task = operation.reload.ai_task
    interview.update!(status: "completed", completed_at: 1.hour.ago - 1.second)
    Interviews::CleanupJob.perform_now
    expect(operation.reload).to be_expired
    expect(task.reload).to be_failed
    expect(task.ai_usage_attempts.count).to eq(1)
  end
end

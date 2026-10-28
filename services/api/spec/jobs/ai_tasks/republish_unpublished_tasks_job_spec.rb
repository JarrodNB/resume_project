# Description: The scheduled job that repairs unpublished AI tasks just calls the service.
require "rails_helper"

RSpec.describe AiTasks::RepublishUnpublishedTasksJob do
  it "runs the republish service" do
    allow(AiTasks::RepublishUnpublishedTasksService).to receive(:call)

    described_class.perform_now

    expect(AiTasks::RepublishUnpublishedTasksService).to have_received(:call)
  end
end

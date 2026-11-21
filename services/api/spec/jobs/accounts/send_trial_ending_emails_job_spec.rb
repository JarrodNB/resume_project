require "rails_helper"

RSpec.describe Accounts::SendTrialEndingEmailsJob, type: :job do
  it "runs on the maintenance queue and calls the service" do
    expect(described_class.new.queue_name).to eq("maintenance")
    allow(Accounts::SendTrialEndingEmailsService).to receive(:call).and_return(ServiceResult.new(success: true, value: 0, errors: []))
    described_class.perform_now
    expect(Accounts::SendTrialEndingEmailsService).to have_received(:call)
  end

  it "is scheduled daily in recurring.yml for development and production" do
    config = YAML.safe_load_file(Rails.root.join("config/recurring.yml"), aliases: true)
    %w[development production].each do |env|
      entry = config.fetch(env).values.find { |task| task["class"] == "Accounts::SendTrialEndingEmailsJob" }
      expect(entry["schedule"]).to match(/every day/)
    end
  end
end

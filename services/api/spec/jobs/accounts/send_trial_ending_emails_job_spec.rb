require "rails_helper"

RSpec.describe Accounts::SendTrialEndingEmailsJob, type: :job do
  include ActiveJob::TestHelper

  it "runs on the maintenance queue and calls the service" do
    expect(described_class.new.queue_name).to eq("maintenance")
    allow(Accounts::SendTrialEndingEmailsService).to receive(:call).and_return(ServiceResult.new(success: true, value: 0, errors: []))
    described_class.perform_now
    expect(Accounts::SendTrialEndingEmailsService).to have_received(:call)
  end

  it "retries a temporary mail enqueue failure without duplicating already queued reminders" do
    travel_to Time.utc(2026, 11, 24, 9, 10) do
      users = 3.times.map { |index| create(:user, trial_ends_at: 10.hours.from_now + index.minutes) }
      clear_enqueued_jobs
      mail_enqueues = 0
      allow(AccountMailDeliveryJob.queue_adapter).to receive(:enqueue).and_wrap_original do |enqueue, job|
        mail_enqueues += 1 if job.is_a?(AccountMailDeliveryJob)
        if job.is_a?(AccountMailDeliveryJob) && mail_enqueues == 2
          raise SolidQueue::Job::EnqueueError, "Temporary queue failure"
        end

        enqueue.call(job)
      end

      expect { described_class.perform_now }.not_to raise_error
      expect(users.map { |user| user.reload.trial_ending_email_sent_at.present? }).to eq([ true, false, false ])
      expect(enqueued_jobs.count { |job| job[:job] == described_class }).to eq(1)
      retry_job = enqueued_jobs.find { |job| job[:job] == described_class }
      expect(retry_job[:at]).to be_within(1.minute).of(5.minutes.from_now.to_f)

      travel_to Time.at(retry_job[:at]).ceil
      perform_enqueued_jobs(only: described_class, at: Time.current)

      expect(users.each(&:reload)).to all(have_attributes(trial_ending_email_sent_at: be_present))
      expect(enqueued_jobs.count { |job| job[:job] == AccountMailDeliveryJob }).to eq(3)
    end
  end

  it "is scheduled daily in recurring.yml for development and production" do
    config = YAML.safe_load_file(Rails.root.join("config/recurring.yml"), aliases: true)
    %w[development production].each do |env|
      entry = config.fetch(env).values.find { |task| task["class"] == "Accounts::SendTrialEndingEmailsJob" }
      expect(entry["schedule"]).to match(/every day/)
    end
  end
end

# Real mail job serialization and bounded SMTP retry with no secrets in operational logs.
require "rails_helper"

RSpec.describe AccountMailDeliveryJob, type: :job do
  include ActiveJob::TestHelper

  it "queues token arguments privately and redacts SMTP failures before retrying" do
    user = create(:user, confirmed_at: nil)
    clear_enqueued_jobs
    output = StringIO.new
    logger = ActiveSupport::Logger.new(output)
    old_logger = ActiveJob::Base.logger
    ActiveJob::Base.logger = logger
    allow_any_instance_of(Mail::Message).to receive(:deliver).and_raise(Net::SMTPFatalError.new("secret SMTP response with #{user.email}"))
    perform_enqueued_jobs(only: AccountMailDeliveryJob, at: Time.current) do
      user.send_confirmation_instructions
    end
    expect(enqueued_jobs.count { |job| job[:job] == AccountMailDeliveryJob }).to eq(1)
    expect(output.string).to include("Account email delivery failed")
    expect(output.string).not_to include(user.email, user.reload.confirmation_token, "secret SMTP response")
    expect(user.reload).not_to be_confirmed
  ensure
    ActiveJob::Base.logger = old_logger
  end

  it "permits delivery recovery and caps failures at three attempts" do
    user = create(:user, confirmed_at: nil)
    clear_enqueued_jobs
    allow_any_instance_of(Mail::Message).to receive(:deliver).and_raise(Net::SMTPFatalError.new("private failure"))
    user.send_confirmation_instructions
    2.times { ActiveJob::Base.execute(enqueued_jobs.shift) }
    expect { ActiveJob::Base.execute(enqueued_jobs.shift) }
      .to raise_error(AccountMailDeliveryJob::DeliveryFailure, "Account email delivery failed")
    expect(enqueued_jobs).to be_empty
    allow_any_instance_of(Mail::Message).to receive(:deliver).and_call_original
    perform_enqueued_jobs(only: AccountMailDeliveryJob) { Accounts::ConfirmAccountService.call(email: user.email) }
    expect(ActionMailer::Base.deliveries.last.to).to eq([ user.email ])
  end

  it "keeps recovery delivery failures private and retries at most three times" do
    user = create(:user)
    clear_enqueued_jobs
    output = StringIO.new
    old_logger = ActiveJob::Base.logger
    ActiveJob::Base.logger = ActiveSupport::Logger.new(output)
    allow_any_instance_of(Mail::Message).to receive(:deliver).and_raise(Net::SMTPFatalError.new("private response #{user.email}"))
    token = user.send_reset_password_instructions
    2.times { ActiveJob::Base.execute(enqueued_jobs.shift) }
    expect { ActiveJob::Base.execute(enqueued_jobs.shift) }
      .to raise_error(AccountMailDeliveryJob::DeliveryFailure, "Account email delivery failed")
    expect(enqueued_jobs).to be_empty
    expect(output.string).not_to include(token, user.email, "private response")
    expect(user.reload.valid_password?("a quiet orchard after rain")).to be(true)
  ensure
    ActiveJob::Base.logger = old_logger
  end
end

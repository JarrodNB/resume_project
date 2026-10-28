# Exercises the real Solid Queue adapter and SQL bind logger inside a rolled-back test transaction.
require "rails_helper"

RSpec.describe "Account mail queue privacy" do
  it "stores delivery arguments in the restricted queue without printing them in debug SQL" do
    user = create(:user)
    token = Devise.friendly_token
    output = StringIO.new
    original = ActiveRecord::Base.logger
    original_app = Rails.logger
    expect(original.level).to be >= Logger::INFO
    Rails.logger = ActiveSupport::Logger.new(output, level: Logger::DEBUG)
    ActiveRecord::Base.logger = ActiveSupport::Logger.new(output, level: original.level)
    %w[confirmation_instructions reset_password_instructions].each do |notification|
      job = AccountMailDeliveryJob.new("AccountMailer", notification, "deliver_now", args: [ user, token ])
      ActiveJob::QueueAdapters::SolidQueueAdapter.new.enqueue(job)
      expect(SolidQueue::Job.last.arguments.to_json).to include(token)
    end
    expect(output.string).not_to include(token, user.email)
  ensure
    ActiveRecord::Base.logger = original
    Rails.logger = original_app
  end
end

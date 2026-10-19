# Uses committed records and real row locks to check competing confirmation and resend work.
require "rails_helper"

RSpec.describe "Confirmation concurrency" do
  self.use_transactional_tests = false

  it "accepts only one simultaneous consumption of a real Devise token" do
    user = build(:user, confirmed_at: nil)
    user.skip_confirmation_notification!
    user.save!
    token = user.confirmation_token
    gate = Queue.new
    threads = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          gate.pop
          Accounts::ConfirmAccountService.call(token: token).success?
        end
      end
    end
    2.times { gate << true }
    expect(threads.map(&:value).sort_by(&:to_s)).to eq([ false, true ])
    expect(user.reload).to be_confirmed
  ensure
    threads&.each(&:join)
    user&.destroy!
  end

  it "never accepts an obsolete token after a racing resend commits" do
    user = build(:user, confirmed_at: nil)
    user.skip_confirmation_notification!
    user.save!
    old = user.confirmation_token
    locked = Queue.new
    release = Queue.new
    resender = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        user.with_lock do
          locked << true
          release.pop
          Accounts::ConfirmAccountService.call(email: user.email)
        end
      end
    end
    locked.pop
    verifier = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection { Accounts::ConfirmAccountService.call(token: old) }
    end
    release << true
    expect(resender.value).to be_success
    expect(verifier.value).not_to be_success
    expect(user.reload).not_to be_confirmed
    expect(Accounts::ConfirmAccountService.call(token: user.confirmation_token)).to be_success
  ensure
    release << true if release
    resender&.join
    verifier&.join
    user&.destroy!
  end
end

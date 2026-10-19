# Separate committed connections verify import serialization across simultaneous callers.
require "rails_helper"
require "timeout"

RSpec.describe JobBoard::ImportListingService do
  self.use_transactional_tests = false

  it "returns one owned job when the same listing is imported concurrently" do
    user = create(:user)
    listing = create(:job_board_listing, payload: { "title" => "Engineer" })
    locked = Queue.new
    release = Queue.new
    holder = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        User.find(user.id).with_lock { locked << true; release.pop }
      end
    end
    Timeout.timeout(10) { locked.pop }
    callers = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          described_class.call(user: User.find(user.id), listing: listing)
        end
      end
    end
    ActiveRecord::Base.connection_pool.with_connection do |connection|
      Timeout.timeout(10) do
        loop do
          break if connection.select_value("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'").to_i >= 2
          sleep 0.01
        end
      end
    end
    release << true
    results = Timeout.timeout(10) { callers.map(&:value) }
    holder.value
    expect(results).to all(be_success)
    expect(results.map { |result| result.value[:job].id }.uniq.size).to eq(1)
    expect(user.jobs.count).to eq(1)
  ensure
    ([ holder ] + Array(callers)).compact.each { |thread| thread.kill if thread.alive?; thread.join }
    user&.destroy!
    listing&.destroy!
  end
end

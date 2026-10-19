# Real committed rows and separate PostgreSQL connections exercise cross-process locking.
require "rails_helper"
require "timeout"

RSpec.describe JobBoard::SearchCatalogueService do
  self.use_transactional_tests = false

  before do
    JobBoardSearchPage.delete_all
    JobBoardListing.delete_all
  end

  after do
    JobBoardSearchPage.delete_all
    JobBoardListing.delete_all
  end

  def concurrent_searches(keywords, provider)
    ready = Queue.new
    start = Queue.new
    threads = keywords.map do |keyword|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          ready << true
          start.pop
          described_class.call(keyword: keyword, provider: provider)
        end
      end
    end
    Timeout.timeout(10) { keywords.size.times { ready.pop } }
    keywords.size.times { start << true }
    Timeout.timeout(15) { threads.map(&:value) }
  ensure
    threads&.each { |thread| thread.kill if thread.alive? }
    threads&.each(&:join)
  end

  it "makes only one provider request for simultaneous identical cache misses" do
    calls = Queue.new
    entered = Queue.new
    release = Queue.new
    provider = lambda do |**_arguments|
      calls << true
      entered << true
      release.pop
      ServiceResult.new(success: true, value: { listings: [ { "id" => 71, "title" => "Engineer" } ], next_cursor: "next" }, errors: [])
    end
    # Keep the first provider request blocked until PostgreSQL confirms a second
    # connection is waiting on the advisory lock, rather than trusting thread timing.
    observer = Thread.new do
      Timeout.timeout(10) { entered.pop }
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        Timeout.timeout(10) do
          loop do
            break if connection.select_value("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'").to_i.positive?
            sleep 0.01
          end
        end
      end
      release << true
    end
    results = concurrent_searches([ "Engineer", "Engineer" ], provider)
    observer.value
    expect(calls.size).to eq(1)
    expect(results).to all(be_success)
    expect(results.map { |result| result.value[:listings].first.id }.uniq.size).to eq(1)
    expect(JobBoardSearchPage.count).to eq(1)
    expect(JobBoardListing.count).to eq(1)
  ensure
    observer&.kill if observer&.alive?
    observer&.join
  end

  it "safely upserts overlapping pages received in opposite provider order" do
    arrived = Queue.new
    release = Queue.new
    provider = lambda do |keyword:, **_arguments|
      arrived << true
      release.pop
      ids = keyword == "A" ? [ 71, 72 ] : [ 72, 71 ]
      ServiceResult.new(success: true, value: { listings: ids.map { |id| { "id" => id, "title" => keyword } }, next_cursor: nil }, errors: [])
    end
    observer = Thread.new do
      Timeout.timeout(10) { 2.times { arrived.pop } }
      2.times { release << true }
    end
    results = concurrent_searches([ "A", "B" ], provider)
    observer.value
    expect(results).to all(be_success)
    expect(results.map { |result| result.value[:listings].map(&:provider_id) }).to eq([ [ 71, 72 ], [ 72, 71 ] ])
    expect(JobBoardSearchPage.count).to eq(2)
    expect(JobBoardListing.count).to eq(2)
  ensure
    observer&.kill if observer&.alive?
    observer&.join
  end
end

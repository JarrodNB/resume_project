# A preparation waits for an in-progress entry edit before freezing its parent and roles.
# Separate committed connections exercise the same parent lock used by grouped writers.
require "rails_helper"
require "timeout"

RSpec.describe "Interview preparation and grouped edit interleaving" do
  self.use_transactional_tests = false

  it "freezes the complete committed entry after an in-progress grouped edit" do
    user = create(:user)
    entry = Experiences::CreateExperienceService.call(user: user, attributes: {
      company: "Original company", roles: [ { title: "Original title" } ]
    }).value
    saved, release, reader_pid = Queue.new, Queue.new, Queue.new
    writer = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        editable = Experience.find(entry.id)
        editable.with_lock do
          result = Experiences::UpdateExperienceService.call(experience: editable, attributes: {
            company: "Edited company", roles: [ { id: editable.roles.first.id, title: "Edited title" } ]
          })
          saved << result
          release.pop
        end
      end
    end
    expect(Timeout.timeout(5) { saved.pop }).to be_success
    reader = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        reader_pid << connection.select_value("SELECT pg_backend_pid()")
        Interviews::StartPreparationService.call(user: User.find(user.id))
      end
    end
    pid = Timeout.timeout(5) { reader_pid.pop }
    blocked = Timeout.timeout(5) do
      loop do
        break true if ActiveRecord::Base.connection.select_value("SELECT cardinality(pg_blocking_pids(#{Integer(pid)}))").positive?
        break false unless reader.alive?
        sleep 0.01
      end
    end
    expect(blocked).to be(true)
    release << true
    Timeout.timeout(5) { writer.value }
    result = Timeout.timeout(5) { reader.value }
    expect(result).to be_success
    texts = result.value.frozen_context.fetch("sources").map { |source| source["text"] }
    expect(texts).to include("Edited company", "Edited title")
    expect(texts).not_to include("Original company", "Original title")
  ensure
    release << true if release
    [ writer, reader ].compact.each { |thread| thread.kill if thread.alive?; thread.join }
    user&.destroy!
  end
end

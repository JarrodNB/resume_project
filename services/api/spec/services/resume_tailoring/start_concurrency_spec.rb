# Competing explicit starts share the owner lock and keep one draft and its first target.
require "rails_helper"

RSpec.describe "Tailoring start concurrency" do
  self.use_transactional_tests = false

  it "returns one task and its original target to simultaneous requests" do
    user = create(:user)
    job = create(:job, user: user)
    queue = instance_double(Shoryuken::Queue, send_message: nil)
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    gate = Queue.new
    threads = [ 1, 2 ].map do |target|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          gate.pop
          ResumeTailoring::StartResumeTailoringService.call(
            user: User.find(user.id), job: user.jobs.find(job.id), target_page_count: target
          )
        end
      end
    end
    2.times { gate << true }
    results = threads.map(&:value)

    expect(results).to all(be_success)
    expect(results.map { |result| result.value.id }.uniq.size).to eq(1)
    expect(results.map { |result| result.value.input["target_page_count"] }.uniq.size).to eq(1)
    expect(job.ai_tasks.tailor_resume.count).to eq(1)
    expect(queue).to have_received(:send_message).once
  ensure
    threads&.each(&:join)
    user&.destroy!
  end
end

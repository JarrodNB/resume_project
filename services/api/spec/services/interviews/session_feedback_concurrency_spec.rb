# Independent committed connections exercise feedback admission and replay under contention.
require "rails_helper"

RSpec.describe "Completed interview feedback concurrency" do
  self.use_transactional_tests = false
  before do
    @user = create(:user, email: "feedback-race-#{SecureRandom.uuid}@example.com")
    @interview = Interviews::CreateFixtureService.call(user: @user, execution_mode: "real").value
    @question = @interview.questions.first
    @interview.messages.create!(question: @question, kind: "answer", position: 1, semantic_key: "answer", content: "I tested a scheduler.")
    @interview.update!(status: "completed", completed_at: Time.current)
    @queue = double(send_message: true)
    allow(Shoryuken::Client).to receive(:queues).and_return(@queue)
  end
  after do
    media = InterviewSessionMedia.where(interview_session: @interview).pluck(:id)
    @user&.destroy!
    InterviewSessionMedia.where(id: media).delete_all
  end

  def race
    ready, start = Queue.new, Queue.new
    threads = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do |connection|
          ready << connection.select_value("SELECT pg_backend_pid()")
          start.pop
          yield
        end
      end
    end
    expect(2.times.map { Timeout.timeout(10) { ready.pop } }.uniq.size).to eq(2)
    2.times { start << true }
    Timeout.timeout(20) { threads.map(&:value) }
  ensure
    2.times { start << true } if start
    threads&.each(&:join)
  end

  it "requests, retries, claims and accepts only one current attempt" do
    service = Interviews::SessionFeedback.new
    requested = race { service.request(interview: InterviewSession.find(@interview.id)) }
    expect(requested).to all(be_success)
    expect(requested.map { |result| result.value.id }.uniq.size).to eq(1)
    expect(@queue).to have_received(:send_message).once
    record = @interview.reload.feedback
    old = record.ai_task
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => old.id, "status" => "failed", "error_message" => "Provider unavailable" })
    retried = race { service.request(interview: InterviewSession.find(@interview.id), retry_failed: true) }
    expect(retried).to all(be_success)
    expect(retried.map { |result| result.value.ai_task_id }.uniq.size).to eq(1)
    expect(record.reload.attempt_count).to eq(2)
    expect(@queue).to have_received(:send_message).twice
    task = record.ai_task
    claimed = race { service.claim(ai_task: AiTask.find(task.id)) }
    expect(claimed.count { |result| result.value[:allowed] }).to eq(1)
    content = { "summary" => "Explain the outcome.", "questions" => [ { "question_id" => @question.id,
      "strengths" => [ "Specific action" ], "improvements" => [ "Add the outcome" ], "example_answer" => "I tested a scheduler. [Add the outcome.]" } ] }
    message = { "ai_task_id" => task.id, "status" => "completed", "result" => { "interview_session_feedback" => content },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 17 } ] }
    expect(race { AiTasks::ApplyAiResultService.call(message: message) }).to all(be_success)
    expect(task.reload).to have_attributes(status: "completed", cost_microdollars: 17)
    expect(record.reload.content).to eq(content)
    expect(task.ai_task_outcomes.pluck(:status)).to eq([ "completed" ])
    expect(InterviewSessionFeedback.where(interview_session: @interview).count).to eq(1)
  end
end

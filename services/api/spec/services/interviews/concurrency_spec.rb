# Real committed records and independent connections exercise contested domain commits.
require "rails_helper"

RSpec.describe "Basic Interview concurrency" do
  self.use_transactional_tests = false

  before do
    @user = create(:user)
    @interview = Interviews::CreateFixtureService.call(user: @user).value
    @question = @interview.questions.first
  end

  after { @user.destroy! }

  def race
    ready, start = Queue.new, Queue.new
    threads = 2.times.map do |index|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do |connection|
          ready << connection.select_value("SELECT pg_backend_pid()")
          start.pop
          yield index
        end
      end
    end
    backends = 2.times.map { Timeout.timeout(10) { ready.pop } }
    expect(backends.uniq.size).to eq(2)
    2.times { start << true }
    Timeout.timeout(20) { threads.map(&:value) }
  ensure
    2.times { start << true } if start
    threads&.each(&:join)
  end

  def submit(key)
    Interviews::SubmitTurnService.call(interview: @user.interview_sessions.find(@interview.id),
      question_id: @question.id, recording_id: @recording_id, expected_revision: 0, submission_key: key)
  end

  it "lets only one competing submission occupy the processing slot" do
    @recording_id = SecureRandom.uuid
    results = race { |index| submit("submission-#{index}") }
    expect(results.count(&:success?)).to eq(1)
    expect(@interview.operations.turn.count).to eq(1)
    expect(@question.reload.accepted_answer_count).to eq(0)
  end

  it "resolves simultaneous identical submissions to the same operation" do
    @recording_id = SecureRandom.uuid
    results = race { submit("same-submission") }
    expect(results).to all(be_success)
    expect(results.map { |result| result.value.id }.uniq.size).to eq(1)
    expect(@interview.operations.turn.count).to eq(1)
  end

  [ false, true ].each do |conflict|
    it "commits one result for #{conflict ? 'conflicting' : 'identical'} concurrent acceptance" do
      @recording_id = SecureRandom.uuid
      turn = submit("one-turn").value
      turn.update!(status: "running", claim_generation: 1, attempt_id: SecureRandom.uuid,
        lease_expires_at: 30.seconds.from_now, execution_deadline: 2.minutes.from_now)
      results = race do |index|
        operation = @user.interview_sessions.find(@interview.id).operations.find(turn.id)
        Interviews::AcceptTurnService.call(operation: operation, attempt_id: turn.attempt_id, claim_generation: 1,
          transcript: conflict ? "Answer #{index}" : "Same answer", decision: "advance", reply: nil,
          history_version: 1, model_history: [ { "kind" => "request", "parts" => [] } ])
      end
      expect(results.count(&:success?)).to eq(conflict ? 1 : 2)
      expect(@interview.reload).to have_attributes(status: "completed", revision: 1)
      expect(@question.reload.accepted_answer_count).to eq(1)
      expect(@interview.messages.pluck(:kind)).to eq(%w[opening answer closing])
      expect(@interview.operations.speech.count).to eq(2)
    end
  end
end

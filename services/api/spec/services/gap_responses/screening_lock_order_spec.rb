# Committed records and real connections verify answer work can overlap library clearing.
# Pausing after a real response lock makes the opposing fact/FK locks deterministic.
require "rails_helper"
require "timeout"

RSpec.describe "Gap answer screening lock order" do
  self.use_transactional_tests = false

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  def concurrently(&operation)
    Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        connection.execute("SET lock_timeout = '5s'")
        operation.call(connection)
      rescue StandardError => error
        error
      ensure
        connection.execute("RESET lock_timeout")
      end
    end
  end

  %i[save clear_answer apply_result].each do |operation|
    it "finishes #{operation} and career-library clearing without a lock cycle" do
      user = create(:user, summary: "Saved summary")
      job = create(:job, user: user)
      fact = create(:library_fact, user: user, requirement: "Shared requirement", response: "Before")
      response = create(:job_gap_response, job: job, library_fact: fact,
        requirement: fact.requirement, body: fact.response)
      task = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", input: {
        "gap_responses" => [ response.attributes.slice("id", "requirement", "body") ]
      })
      locked, release, backend_pids = Queue.new, Queue.new, Queue.new
      # Instrument the seam without replacing row locking or transactional writes.
      allow_any_instance_of(JobGapResponse).to receive(:lock!).and_wrap_original do |original, *args|
        original.call(*args).tap { locked << true; release.pop }
      end
      first = concurrently do |connection|
        backend_pids << connection.select_value("SELECT pg_backend_pid()")
        if operation == :apply_result
          AiTasks::ApplyAiResultService.call(message: {
            "ai_task_id" => task.id, "status" => "failed", "error_message" => "Generation failed",
            "gap_response_screening" => [ { "response_id" => response.id, "fields" => {
              "body" => GapResponses::RecordScreeningService.field_fingerprint(response.body)
            } } ],
            "library_screening" => [ { "record_type" => "user", "record_id" => user.id, "fields" => [ "summary" ] } ]
          })
        else
          GapResponses::SaveGapResponseService.call(job: Job.find(job.id), requirement: fact.requirement,
            body: operation == :save ? "After" : "", add_to_library: true)
        end
      end
      first_pid = Timeout.timeout(5) { backend_pids.pop }
      Timeout.timeout(5) { locked.pop }
      clearer = concurrently do |connection|
        backend_pids << connection.select_value("SELECT pg_backend_pid()")
        CareerLibrary::ClearCareerLibraryService.call(user: User.find(user.id))
      end
      clear_pid = Timeout.timeout(5) { backend_pids.pop }
      Timeout.timeout(5) do
        connection = ActiveRecord::Base.connection
        until connection.select_value("SELECT #{first_pid.to_i} = ANY(pg_blocking_pids(#{clear_pid.to_i}))")
          Thread.pass
        end
      end
      release << true
      results = Timeout.timeout(10) { [ first.value, clearer.value ] }
      expect(results).to all(be_a(ServiceResult))
      expect(results).to all(be_success)
      expect(user.reload.library_facts).to be_empty
      expect(user.summary).to be_nil
      expect(user.screened_fields).not_to include("summary")
      if operation == :clear_answer
        expect(job.gap_responses).to be_empty
      else
        expect(response.reload.library_fact_id).to be_nil
        expect(response.body).to eq(operation == :save ? "After" : "Before")
        expect(response.screened_fields).to include("body") if operation == :apply_result
      end
    ensure
      release << true if release
      [ first, clearer ].compact.each { |thread| thread.join(6) }
      user&.destroy!
    end
  end
end

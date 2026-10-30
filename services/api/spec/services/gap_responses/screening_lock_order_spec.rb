# Committed records and real connections verify answer work can overlap library clearing.
# Pausing after a real response lock makes the opposing context/FK locks deterministic.
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
      context = create(:career_context, user: user, requirement: "Shared requirement", response: "Before")
      response = create(:job_gap_response, job: job, career_context: context,
        requirement: context.requirement, body: context.response)
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
            "library_screening" => [ { "record_type" => "user", "record_id" => user.id, "fields" => [ "summary" ],
              "fingerprints" => { "summary" => Jobs::RecordScreeningService.field_fingerprint(user.summary) } } ]
          })
        else
          GapResponses::SaveGapResponseService.call(job: Job.find(job.id), requirement: context.requirement,
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
      expect(user.reload.career_contexts).to be_empty
      expect(user.summary).to be_nil
      expect(user.screened_fields).not_to include("summary")
      if operation == :clear_answer
        expect(job.gap_responses).to be_empty
      else
        expect(response.reload.career_context_id).to be_nil
        expect(response.body).to eq(operation == :save ? "After" : "Before")
        expect(response.screened_fields).to include("body") if operation == :apply_result
      end
    ensure
      release << true if release
      [ first, clearer ].compact.each { |thread| thread.join(6) }
      user&.destroy!
    end
  end

  it "applies gap analysis and tailoring reports for the same job without a lock cycle" do
    user = create(:user, summary: "Saved summary")
    job = create(:job, user: user)
    analysis = create(:ai_task, user: user, subject: job, task_type: "analyze_gaps")
    tailoring = create(:ai_task, user: user, subject: job, task_type: "tailor_resume")
    locked, release, backend_pids = Queue.new, Queue.new, Queue.new
    allow_any_instance_of(Job).to receive(:lock!).and_wrap_original do |original, *args|
      original.call(*args).tap do
        if Thread.current[:pause_gap_analysis_job]
          locked << true
          release.pop
        end
      end
    end
    report = { "job_id" => job.id, "fields" => {
      "title" => Jobs::RecordScreeningService.field_fingerprint(job.title)
    } }
    apply_report = lambda do |task|
      AiTasks::ApplyAiResultService.call(message: {
        "ai_task_id" => task.id, "status" => "failed", "error_message" => "Generation failed",
        "job_screening" => [ report ], "library_screening" => [ {
          "record_type" => "user", "record_id" => user.id, "fields" => [ "summary" ],
          "fingerprints" => { "summary" => Jobs::RecordScreeningService.field_fingerprint(user.summary) }
        } ]
      })
    end
    first = concurrently do |connection|
      Thread.current[:pause_gap_analysis_job] = true
      backend_pids << connection.select_value("SELECT pg_backend_pid()")
      apply_report.call(analysis)
    end
    analysis_pid = Timeout.timeout(5) { backend_pids.pop }
    Timeout.timeout(5) { locked.pop }
    second = concurrently do |connection|
      backend_pids << connection.select_value("SELECT pg_backend_pid()")
      apply_report.call(tailoring)
    end
    tailor_pid = Timeout.timeout(5) { backend_pids.pop }
    Timeout.timeout(5) do
      connection = ActiveRecord::Base.connection
      until connection.select_value("SELECT #{analysis_pid.to_i} = ANY(pg_blocking_pids(#{tailor_pid.to_i}))")
        Thread.pass
      end
    end
    release << true
    results = Timeout.timeout(10) { [ first.value, second.value ] }
    expect(results).to all(be_a(ServiceResult))
    expect(results).to all(be_success)
    expect(analysis.reload).to be_failed
    expect(tailoring.reload).to be_failed
    expect(job.reload.screened_fields).to eq([ "title" ])
    expect(user.reload.screened_fields).to eq([ "summary" ])
  ensure
    release << true if release
    [ first, second ].compact.each { |thread| thread.join(6) }
    user&.destroy!
  end
end

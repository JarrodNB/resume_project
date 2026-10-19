# Real connections exercise late results while the user saves a draft or imports a resume.
# Holding a first row lock reproduces contention without replacing domain work.
require "rails_helper"
require "timeout"

RSpec.describe "Concurrent results and resume writes" do
  self.use_transactional_tests = false

  let(:user) { create(:user, summary: "Backend engineer") }

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }
  after { user.destroy! }

  it "saves the resume and applies late screening and usage without a lock-order deadlock" do
    sections = [ { "section_type" => "summary", "content" => { "text" => "Backend engineer" } } ]
    task = create(:ai_task, user: user, subject: create(:job, user: user), task_type: "tailor_resume",
      status: "completed", result: { "sections" => sections })
    message = {
      "ai_task_id" => task.id, "status" => "completed", "attempt_id" => SecureRandom.uuid,
      "result" => { "sections" => sections }, "usage" => [ { "input_tokens" => 3, "cost_microdollars" => 7 } ],
      "screening_successes" => [ { "record_type" => "User", "record_id" => user.id,
        "observed_updated_at" => user.updated_at.iso8601(6), "screening_policy_version" => "policy-1" } ]
    }
    outcomes = run_while_record_locked(
      locked_operation: -> { ResumeTailoring::SaveTailoredResumeService.call(ai_task: AiTask.find(task.id)) },
      competing_operation: -> { AiTasks::ApplyAiResultService.call(message: message) }
    )
    expect(outcomes.grep(Exception)).to be_empty
    expect(outcomes).to all(be_success)

    AiTasks::ApplyAiResultService.call(message: message)
    expect(user.resumes.count).to eq(1)
    expect(task.reload).to have_attributes(status: "completed", input_tokens: 3, cost_microdollars: 7,
      result: { "sections" => sections })
    expect(task).to be_accepted
    expect(task.ai_usage_attempts.count).to eq(1)
    expect(user.reload.screened_at).to be_present
    expect(user.screening_policy_version).to eq("policy-1")
    expect(ApiSchema.subscriptions).not_to have_received(:trigger)
  end

  it "imports once while a late parse result applies without a lock-order deadlock" do
    user.update!(name: nil, summary: nil)
    task = create(:ai_task, :completed_resume_parse, user: user)
    original_result = task.result
    parsed = { "contact" => { "full_name" => "Imported Person" }, "summary" => "Imported summary",
               "skills" => [ { "name" => "Ruby" } ] }
    message = { "ai_task_id" => task.id, "status" => "completed", "attempt_id" => SecureRandom.uuid,
                "result" => original_result, "usage" => [ { "cost_microdollars" => 7 } ] }
    outcomes = run_while_record_locked(
      locked_operation: -> { AiTasks::ApplyAiResultService.call(message: message) },
      competing_operation: -> { ResumeImports::ImportParsedResumeService.call(ai_task: AiTask.find(task.id), parsed_resume: parsed) }
    )
    expect(outcomes.grep(Exception)).to be_empty
    expect(outcomes).to all(be_success)
    expect(user.reload).to have_attributes(name: "Imported Person", summary: "Imported summary",
      screened_at: nil, screening_policy_version: nil)
    expect(user.skills.pluck(:name)).to eq([ "Ruby" ])
    expect(task.reload).to be_accepted
    expect(task).to have_attributes(status: "completed", cost_microdollars: 7)
    expect(task.result.except("import_summary")).to eq(original_result)
    expect(task.result["import_summary"]).to eq("added" => 0, "merged" => 0)
    AiTasks::ApplyAiResultService.call(message: message)
    duplicate = ResumeImports::ImportParsedResumeService.call(ai_task: task.reload, parsed_resume: parsed)
    expect(duplicate.errors).to eq([ "This resume has already been imported" ])
    expect(task.reload.cost_microdollars).to eq(7)
    expect(task.ai_usage_attempts.count).to eq(1)
    expect(user.skills.count).to eq(1)
    expect(ApiSchema.subscriptions).not_to have_received(:trigger)
  end

  it "clears the library while a late source screening result applies without a lock-order deadlock" do
    role = create(:experience, user: user)
    task = create(:ai_task, user: user, status: "completed", result: { "saved" => true })
    message = {
      "ai_task_id" => task.id, "status" => "completed", "attempt_id" => SecureRandom.uuid,
      "result" => { "saved" => true }, "usage" => [ { "cost_microdollars" => 7 } ],
      "screening_successes" => [ { "record_type" => "Experience", "record_id" => role.id,
        "observed_updated_at" => role.updated_at.iso8601(6), "screening_policy_version" => "policy-1" } ]
    }
    outcomes = run_while_record_locked(
      locked_operation: -> { AiTasks::ApplyAiResultService.call(message: message) },
      competing_operation: -> { CareerLibrary::ClearCareerLibraryService.call(user: User.find(user.id)) }
    )
    expect(outcomes.grep(Exception)).to be_empty
    expect(outcomes).to all(be_success)
    expect(user.experiences).to be_empty
    expect(user.reload).to have_attributes(summary: nil, screened_at: nil, screening_policy_version: nil)
    expect(task.reload).to have_attributes(status: "completed", cost_microdollars: 7, result: { "saved" => true })
    expect(task.ai_usage_attempts.count).to eq(1)
    expect(ApiSchema.subscriptions).not_to have_received(:trigger)
  end

  it "moves a highlight while a two-record screening report applies without retaining source locks" do
    source = create(:experience, user: user)
    destination = create(:experience, user: user)
    highlight = create(:experience_highlight, experience: source)
    task = create(:ai_task, user: user, status: "completed", result: { "saved" => true })
    reports = [ destination, source ].map do |record|
      { "record_type" => "Experience", "record_id" => record.id,
        "observed_updated_at" => record.updated_at.iso8601(6), "screening_policy_version" => "policy-1" }
    end
    message = { "ai_task_id" => task.id, "status" => "completed", "screening_successes" => reports,
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "cost_microdollars" => 7 } ] }
    outcomes = run_while_record_locked(
      locked_record: source,
      locked_operation: -> { Experiences::MoveHighlightService.call(highlight: ExperienceHighlight.find(highlight.id),
        experience: Experience.find(destination.id), position: 0) },
      competing_operation: -> { AiTasks::ApplyAiResultService.call(message: message) }
    )
    expect(outcomes.grep(Exception)).to be_empty
    expect(outcomes).to all(be_success)
    expect(highlight.reload.experience_id).to eq(destination.id)
    [ source, destination ].each do |record|
      expect(record.reload).to have_attributes(screened_at: nil, screening_policy_version: nil)
    end
    expect(task.reload).to have_attributes(status: "completed", cost_microdollars: 7, result: { "saved" => true })
    expect(task.ai_usage_attempts.count).to eq(1)
  end

  it "retains successful screening when the later outcome transaction fails and is retried" do
    project = create(:project, user: user)
    version = project.updated_at
    task = create(:ai_task, user: user)
    message = { "ai_task_id" => task.id, "status" => "completed", "result" => { "saved" => true },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "cost_microdollars" => 7 } ],
      "screening_successes" => [ { "record_type" => "Project", "record_id" => project.id,
        "observed_updated_at" => version.iso8601(6), "screening_policy_version" => "policy-1" } ] }
    allow(AiTasks::RecordAttemptUsageService).to receive(:call).and_raise("Synthetic accounting failure")
    expect { AiTasks::ApplyAiResultService.call(message: message) }.to raise_error("Synthetic accounting failure")
    expect(project.reload).to have_attributes(screening_policy_version: "policy-1", updated_at: version)
    expect(project.screened_at).to be_present
    expect(task.reload).to have_attributes(status: "queued", cost_microdollars: 0)
    expect(task.ai_usage_attempts.count).to eq(0)

    allow(AiTasks::RecordAttemptUsageService).to receive(:call).and_call_original
    expect(AiTasks::ApplyAiResultService.call(message: message)).to be_success
    expect(task.reload).to have_attributes(status: "completed", cost_microdollars: 7, result: { "saved" => true })
    expect(task.ai_usage_attempts.count).to eq(1)
  end

  [ [ :experience, Experiences::UpdateExperienceService, :experience, { description: "Changed" } ],
    [ :project, Projects::UpdateProjectService, :project, { description: "Changed" } ],
    [ :education, Educations::UpdateEducationService, :education, { degree: "Changed" } ],
    [ :certification, Certifications::UpdateCertificationService, :certification, { issuer: "Changed" } ],
    [ :skill, Skills::UpdateSkillService, :skill, { category: "Changed" } ],
    [ :library_fact, LibraryFacts::UpdateLibraryFactService, :library_fact, { response: "Changed" } ] ].each do |factory, service, key, attributes|
    it "rejects a stale #{factory} report after waiting for a concurrent edit on its ordered association" do
      record = create(factory, user: user)
      version = record.updated_at
      task = create(:ai_task, user: user, status: "completed", result: {})
      message = { "ai_task_id" => task.id, "status" => "completed", "result" => {},
        "screening_successes" => [ { "record_type" => record.class.name, "record_id" => record.id,
          "observed_updated_at" => version.iso8601(6), "screening_policy_version" => "policy-1" } ] }
      outcomes = run_while_record_locked(
        locked_record: record,
        locked_operation: -> { service.call(**{ key => record.class.find(record.id), attributes: attributes }) },
        competing_operation: -> { AiTasks::ApplyAiResultService.call(message: message) }
      )
      expect(outcomes.grep(Exception)).to be_empty
      expect(outcomes).to all(be_success)
      expect(record.reload).to have_attributes(screened_at: nil, screening_policy_version: nil)
      expect(record.updated_at).to be > version
    end
  end

  # Starts real service calls on separate connections and holds one record transaction
  # until PostgreSQL confirms the competing call is blocked by that record.
  def run_while_record_locked(locked_operation:, competing_operation:, locked_record: user)
    record_locked, competing_started, continue_holder = Queue.new, Queue.new, Queue.new
    threads = []
    threads << Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        locked_record.class.find(locked_record.id).with_lock do
          record_locked << connection.select_value("SELECT pg_backend_pid()")
          continue_holder.pop
          locked_operation.call
        end
      end
    rescue StandardError => error
      error
    end
    holder_pid = Timeout.timeout(10) { record_locked.pop }
    threads << Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        competing_started << connection.select_value("SELECT pg_backend_pid()")
        competing_operation.call
      end
    rescue StandardError => error
      error
    end
    competing_pid = Timeout.timeout(10) { competing_started.pop }

    # If the competing call retained an earlier lock, the holder's real operation
    # can close a deadlock cycle. The service fix must leave that operation free.
    Timeout.timeout(10) do
      loop do
        blocked = ActiveRecord::Base.connection.select_value("SELECT #{holder_pid.to_i} = ANY(pg_blocking_pids(#{competing_pid.to_i}))")
        break if blocked

        sleep 0.01
      end
    end
    continue_holder << true
    Timeout.timeout(10) { threads.map(&:value) }
  ensure
    continue_holder << true if continue_holder
    threads&.each { |thread| thread.join(15) }
  end
end

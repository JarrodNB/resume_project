# Check the real durable queue against the application database, without providers.
require "rails_helper"
require "open3"

RSpec.describe "Durable Rails job storage" do
  self.use_transactional_tests = false

  before do
    @user_ids = []
    @job_ids = []
  end

  after do
    SolidQueue::Job.where(active_job_id: @job_ids).destroy_all
    User.where(id: @user_ids).destroy_all
  end

  def create_probe_user
    create(:user, email: "queue-#{SecureRandom.uuid}@example.test").tap { |user| @user_ids << user.id }
  end

  def enqueue_probe(user)
    DurableQueueProbeJob.new(user.id).tap do |job|
      @job_ids << job.job_id
      job.enqueue
    end
  end

  def from_another_connection(&block)
    Thread.new { ApplicationRecord.connection_pool.with_connection(&block) }.value
  end

  def rails_process(source)
    output, error, status = Open3.capture3(
      { "RAILS_ENV" => "test" }, "bundle", "exec", "rails", "runner", "-",
      stdin_data: "require Rails.root.join('spec/support/durable_queue_probe_job')\n#{source}",
      chdir: Rails.root
    )
    expect(status.success?).to be(true), "Probe process failed: #{error}\n#{output}"
    output
  end

  it "installs queue storage on the primary database connection" do
    expect(SolidQueue::Record.connection_pool).to equal(ApplicationRecord.connection_pool)
    expect(ApplicationRecord.connection.data_source_exists?("solid_queue_jobs")).to be(true)
  end

  it "commits the domain write and ready job together, invisible to another consumer until commit" do
    user = job = nil
    ApplicationRecord.transaction do
      user = create_probe_user
      job = enqueue_probe(user)
      expect(SolidQueue::ReadyExecution.joins(:job).where(job: { active_job_id: job.job_id })).to exist
      visible = from_another_connection do
        [ User.exists?(user.id), SolidQueue::Job.exists?(active_job_id: job.job_id) ]
      end
      expect(visible).to eq([ false, false ])
    end

    visible = from_another_connection do
      [ User.exists?(user.id), SolidQueue::Job.exists?(active_job_id: job.job_id) ]
    end
    expect(visible).to eq([ true, true ])
  end

  it "rolls back both domain and job records" do
    user = job = nil
    ApplicationRecord.transaction do
      user = create_probe_user
      job = enqueue_probe(user)
      raise ActiveRecord::Rollback
    end

    expect(User.exists?(user.id)).to be(false)
    expect(SolidQueue::Job.exists?(active_job_id: job.job_id)).to be(false)
  end

  it "aborts the domain transaction when real queue insertion fails" do
    connection = ApplicationRecord.connection
    constraint = "reject_durable_queue_probe"
    connection.add_check_constraint(:solid_queue_jobs, "class_name <> 'DurableQueueProbeJob'", name: constraint)
    user = nil

    expect do
      ApplicationRecord.transaction do
        user = create_probe_user
        enqueue_probe(user)
      end
    end.to raise_error(SolidQueue::Job::EnqueueError)

    expect(User.exists?(user.id)).to be(false)
    expect(SolidQueue::Job.where(active_job_id: @job_ids)).not_to exist
  ensure
    connection.remove_check_constraint(:solid_queue_jobs, name: constraint) if connection&.check_constraint_exists?(:solid_queue_jobs, name: constraint)
  end

  it "keeps delayed work durable without making it ready before its deadline" do
    user = create_probe_user
    job = DurableQueueProbeJob.new(user.id)
    @job_ids << job.job_id
    at = 1.minute.from_now

    job.enqueue(wait_until: at)

    stored = SolidQueue::Job.find_by!(active_job_id: job.job_id)
    expect(SolidQueue::ScheduledExecution.find_by!(job: stored).scheduled_at).to be_within(1.second).of(at)
    expect(SolidQueue::ReadyExecution.where(job: stored)).not_to exist
  end

  it "executes a persisted job in a fresh process after its enqueuing process exits" do
    user = create_probe_user
    output = rails_process("job = DurableQueueProbeJob.perform_later(#{user.id.inspect}); puts \"probe_job_id=\#{job.job_id}\"")
    job_id = output.lines.find { |line| line.start_with?("probe_job_id=") }.strip.split("=", 2).last
    @job_ids << job_id
    expect(SolidQueue::Job.find_by!(active_job_id: job_id).ready_execution).to be_present

    rails_process(<<~RUBY)
      worker = SolidQueue::Process.register(kind: "Worker", name: "probe-\#{SecureRandom.uuid}", pid: Process.pid, hostname: "test")
      SolidQueue::ReadyExecution.claim([ "durability_probes" ], 1, worker.id).each(&:perform)
      worker.deregister
    RUBY

    expect(user.reload.summary).to eq("Durable queue execution completed")
    expect(SolidQueue::ReadyExecution.joins(:job).where(job: { active_job_id: job_id })).not_to exist
  end
end

# Description: Applying ai_results messages, including duplicate (redelivered) messages and the
# Job a completed scrape_job saves.
require "rails_helper"
require "digest"
require "json"

RSpec.describe AiTasks::ApplyAiResultService do
  let(:ai_task) { create(:ai_task) }

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  # Builds a result message for ai_task with string keys, as parsed from JSON.
  def result_message(status, **fields)
    { "ai_task_id" => ai_task.id, "status" => status }.merge(fields.stringify_keys)
  end

  # An older-format library report with fingerprints of the record's current values.
  def library_report(record, fields)
    { "record_type" => record.class.name.underscore, "record_id" => record.id, "fields" => fields,
      "fingerprints" => fields.to_h { |field| [ field, fingerprint(record.has_attribute?(field) ? record[field] : nil) ] } }
  end

  def fingerprint(value)
    Digest::SHA256.hexdigest(JSON.generate(value))
  end

  it "remembers successful library field checks on failed generation, idempotently and only for its owner" do
    own = create(:project, user: ai_task.user)
    other = create(:project)
    reports = [ own, other ].map { |record| library_report(record, %w[name unknown]) }
    message = result_message("failed", error_message: "Generation failed", record_screening: reports)
    2.times { described_class.call(message: message) }

    expect(own.reload.screened_fields).to eq([ "name" ])
    expect(other.reload.screened_fields).to eq([])
  end

  it "does not approve older-format library reports without a matching fingerprint" do
    project = create(:project, user: ai_task.user)
    reports = [ { "record_type" => "project", "record_id" => project.id, "fields" => [ "name" ] },
                library_report(project, [ "name" ]).merge("fingerprints" => { "name" => "0" * 64 }) ]
    described_class.call(message: result_message("failed", error_message: "Generation failed", record_screening: reports))
    expect(project.reload.screened_fields).to eq([])
  end

  it "records multiple kinds of unified record_screening receipts" do
    user = ai_task.user
    project = create(:project, user: user)
    skill = create(:skill, user: user)
    job = create(:job, user: user)
    task = create(:ai_task, user: user, subject: job, task_type: "analyze_gaps")
    receipts = [
      { "record_type" => "skill", "record_id" => skill.id, "fingerprints" => { "name" => fingerprint(skill.name) } },
      { "record_type" => "job", "record_id" => job.id, "fingerprints" => { "title" => fingerprint(job.title) } }
    ]
    message = { "ai_task_id" => task.id, "status" => "failed", "error_message" => "Generation failed",
                "record_screening" => receipts + [ library_report(project, [ "name" ]) ] }
    expect(described_class.call(message: message)).to be_success
    expect(skill.reload.screened_fields).to eq([ "name" ])
    expect(job.reload.screened_fields).to eq([ "title" ])
    expect(project.reload.screened_fields).to eq([ "name" ])
  end

  it "ignores summary-generation library receipts, including the profile summary, that its snapshot did not freeze" do
    user = ai_task.user
    user.update!(summary: "I build tools.")
    skill = create(:skill, user: user)
    task = create(:ai_task, user: user, task_type: "generate_summary")
    receipts = [ { "record_type" => "skill", "record_id" => skill.id, "fingerprints" => { "name" => fingerprint(skill.name) } },
                 { "record_type" => "user", "record_id" => user.id, "fingerprints" => { "summary" => fingerprint(user.summary) } } ]
    described_class.call(message: { "ai_task_id" => task.id, "status" => "failed", "error_message" => "Generation failed",
                                     "record_screening" => receipts })
    expect(skill.reload.screened_fields).to eq([])
    expect(user.reload.screened_fields).to eq([])
  end

  it "checks review-task record_screening receipts against the frozen snapshot, ignoring fields it lacks" do
    user = ai_task.user
    role = create(:experience, user: user, description: "Old", location: "Remote")
    task = create(:ai_task, user: user, task_type: "review_library_section", input: { "library" => {
      "experiences" => [ role.attributes.slice("id", "company", "title", "description").merge("highlights" => []) ]
    } })
    role.update!(description: "New unscreened")
    receipt = { "record_type" => "experience", "record_id" => role.id, "fingerprints" => {
      "company" => fingerprint(role.company), "description" => fingerprint(role.description), "location" => fingerprint(role.location)
    } }
    described_class.call(message: { "ai_task_id" => task.id, "status" => "failed", "error_message" => "Generation failed",
                                     "record_screening" => [ receipt ] })
    expect(role.reload.screened_fields).to eq([ "company" ])
  end

  it "does not restore an edited field's check when a final result is redelivered" do
    project = create(:project, user: ai_task.user)
    message = result_message("failed", error_message: "Generation failed", record_screening: [ library_report(project, [ "name" ]) ])
    described_class.call(message: message)
    Projects::UpdateProjectService.call(project: project.reload, attributes: { name: "Edited" })
    described_class.call(message: message)
    expect(project.reload.screened_fields).to eq([])
  end

  it "accepts each library kind and rejects another owner's profile and highlights" do
    user = ai_task.user
    experience = create(:experience, user: user)
    records = [ user, experience, create(:experience_highlight, experience: experience),
               create(:project, user: user), create(:education, user: user),
               create(:certification, user: user), create(:skill, user: user), create(:career_context, user: user) ]
    reports = records.map { |record| library_report(record, record.class.screened_field_names) }
    other_user = create(:user)
    other_highlight = create(:experience_highlight)
    reports += [
      library_report(other_user, [ "summary" ]),
      library_report(other_highlight, [ "content" ]),
      { "record_type" => "job", "record_id" => SecureRandom.uuid, "fields" => [ "title" ], "fingerprints" => { "title" => "0" * 64 } }
    ]
    expect(described_class.call(message: result_message("completed", result: {}, record_screening: reports))).to be_success
    records.each { |record| expect(record.reload.screened_fields).to eq(record.class.screened_field_names) }
    expect(other_user.reload.screened_fields).to eq([])
    expect(other_highlight.reload.screened_fields).to eq([])
  end

  it "does not apply screening on usage-only messages" do
    project = create(:project, user: ai_task.user)
    receipt = { "record_type" => "project", "record_id" => project.id, "fingerprints" => { "name" => fingerprint(project.name) } }
    described_class.call(message: result_message("usage", attempt_id: SecureRandom.uuid,
                                                 record_screening: [ receipt ]))
    expect(project.reload.screened_fields).to eq([])
  end

  it "completes the task and notifies subscribers" do
    result = described_class.call(message: result_message("completed", result: { "echo" => "hi" }))

    expect(result).to be_success
    expect(ai_task.reload).to be_completed
    expect(ai_task.result).to eq("echo" => "hi")
    expect(ai_task.completed_at).to be_present
    expect(ai_task.ai_task_outcomes.sole.status).to eq("completed")
    expect(ApiSchema.subscriptions).to have_received(:trigger)
      .with(:ai_task_updated, { id: ai_task.id }, ai_task)
  end

  it "ignores a duplicate result for a finished task" do
    described_class.call(message: result_message("completed", result: { "attempt" => 1 }))
    result = described_class.call(message: result_message("completed", result: { "attempt" => 2 }))

    expect(result).to be_success
    expect(ai_task.reload.result).to eq("attempt" => 1)
    expect(ai_task.ai_task_outcomes.count).to eq(1)
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: ai_task.id }, ai_task).once
  end

  it "ignores a late result for a failed task" do
    described_class.call(message: result_message("failed", error_message: "Model timed out"))
    described_class.call(message: result_message("completed", result: { "echo" => "late" }))

    expect(ai_task.reload).to be_failed
    expect(ai_task.result).to be_nil
    expect(ai_task.error_message).to eq("Model timed out")
  end

  it "completes a tailor draft without changing its input snapshots" do
    input = { "job_id" => SecureRandom.uuid, "contact" => { "full_name" => "Synthetic Person" } }
    ai_task.update!(task_type: "tailor_resume", input: input)
    sections = [ { "section_type" => "summary", "title" => "Summary", "content" => { "text" => "A draft." } } ]

    described_class.call(message: result_message("completed", result: { "sections" => sections, "warnings" => [] }))

    expect(ai_task.reload).to be_completed
    expect(ai_task.result).to eq("sections" => sections, "warnings" => [])
    expect(ai_task.input).to eq(input)
    expect(ai_task.pending_questions).to eq([])
  end

  it "counts duplicate complete-draft results once without recreating approval state" do
    ai_task.update!(task_type: "tailor_resume", input: { "job_id" => SecureRandom.uuid })
    usage = [ { "model" => "openai:gpt-5-mini", "input_tokens" => 10, "cached_input_tokens" => 0, "output_tokens" => 2, "cost_microdollars" => 15 } ]
    message = result_message("completed", attempt_id: SecureRandom.uuid, usage: usage,
                             result: { "sections" => [ { "section_type" => "summary" } ] })

    2.times { described_class.call(message: message) }

    expect(ai_task.reload.cost_microdollars).to eq(15)
    expect(ai_task.input.keys).to eq([ "job_id" ])
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: ai_task.id }, ai_task).once
  end

  it "notifies subscribers when a late usage report changes a finished task's cost" do
    ai_task.update!(status: "completed", completed_at: Time.current)
    usage = [ { "model" => "openai:gpt-5-mini", "input_tokens" => 10, "cached_input_tokens" => 0, "output_tokens" => 2, "cost_microdollars" => 15 } ]
    message = result_message("usage", attempt_id: SecureRandom.uuid, usage: usage)

    2.times { described_class.call(message: message) }

    expect(ai_task.reload.cost_microdollars).to eq(15)
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: ai_task.id }, ai_task).once
  end

  it "keeps the tailoring snapshots when generation fails without a partial draft" do
    input = { "contact" => { "full_name" => "Synthetic Person" }, "gap_responses" => [] }
    ai_task.update!(task_type: "tailor_resume", input: input)

    described_class.call(message: result_message("failed", error_message: "The AI task failed"))

    expect(ai_task.reload).to be_failed
    expect(ai_task.result).to be_nil
    expect(ai_task.input).to eq(input)
  end

  it "stores questions and message history when the AI needs user input" do
    message = result_message(
      "needs_user_input",
      pending_questions: [ { "question" => "Did you lead the migration?" } ],
      message_history: [ { "kind" => "request" } ]
    )
    described_class.call(message: message)

    expect(ai_task.reload).to be_needs_user_input
    expect(ai_task.pending_questions).to eq([ { "question" => "Did you lead the migration?" } ])
    expect(ai_task.message_history).to eq([ { "kind" => "request" } ])
    expect(ai_task.completed_at).to be_nil
  end

  describe "token usage" do
    let(:usage) do
      [
        { "model" => "openai:gpt-5-mini", "input_tokens" => 1000, "cached_input_tokens" => 200,
          "output_tokens" => 300, "cost_microdollars" => 805 },
        { "model" => "openai:gpt-5-mini", "input_tokens" => 500, "cached_input_tokens" => 0,
          "output_tokens" => 100, "cost_microdollars" => 325 }
      ]
    end

    it "stores the summed usage of every agent run" do
      described_class.call(message: result_message("completed", result: {}, usage: usage))

      expect(ai_task.reload).to have_attributes(
        input_tokens: 1500, cached_input_tokens: 200, output_tokens: 400, cost_microdollars: 1130
      )
    end

    it "doesn't double-count a redelivered needs_user_input message" do
      2.times { described_class.call(message: result_message("needs_user_input", usage: usage)) }

      expect(ai_task.reload.cost_microdollars).to eq(1130)
    end

    it "records zero usage when the message has none" do
      described_class.call(message: result_message("failed", error_message: "The AI task failed"))

      expect(ai_task.reload.cost_microdollars).to eq(0)
    end
  end

  describe "completed scrape_job" do
    let(:url) { "https://www.linkedin.com/jobs/view/1/" }
    let(:ai_task) { create(:ai_task, task_type: "scrape_job", input: { "url" => url }) }
    let(:scraped_job) do
      { "title" => "AI Engineer", "company" => "Acme", "requirements" => [ "Python" ], "nice_to_haves" => [] }
    end

    it "saves the job once, even when the result is redelivered, and links it to the task" do
      2.times { described_class.call(message: result_message("completed", result: { "scraped_job" => scraped_job })) }

      job = ai_task.user.jobs.sole
      expect(job).to have_attributes(title: "AI Engineer", url: url, requirements: [ "Python" ])
      expect(ai_task.reload).to be_completed
      expect(ai_task.subject).to eq(job)
    end

    it "applies an unknown-company result once and keeps it owned by the task's user" do
      other_user = create(:user)
      posting = scraped_job.merge("company" => nil)
      2.times { described_class.call(message: result_message("completed", result: { "scraped_job" => posting })) }

      expect(ai_task.reload).to be_completed
      expect(ai_task.user.jobs.sole).to have_attributes(company: nil, title: "AI Engineer")
      expect(other_user.jobs).to be_empty
    end

    it "fails the task when the job can't be saved" do
      described_class.call(
        message: result_message("completed", result: { "scraped_job" => scraped_job.merge("title" => "") })
      )

      expect(ai_task.reload).to be_failed
      expect(ai_task.error_message).to eq("We couldn't save this job: Title can't be blank")
      expect(ai_task.result).to be_nil
      expect(ai_task.user.jobs).to be_empty
    end
  end

  describe "completed parse_job_posting" do
    let(:ai_task) { create(:ai_task, task_type: "parse_job_posting", input: { "text" => "AI Engineer at Acme" }) }
    let(:scraped_job) do
      {
        "source_url" => "", "title" => "AI Engineer", "company" => "Acme",
        "description" => "AI Engineer at Acme", "requirements" => [ "Python" ], "nice_to_haves" => []
      }
    end

    it "saves the job once, even when the result is redelivered, and links it to the task" do
      2.times { described_class.call(message: result_message("completed", result: { "scraped_job" => scraped_job })) }

      job = ai_task.user.jobs.sole
      expect(job).to have_attributes(title: "AI Engineer", url: nil, requirements: [ "Python" ])
      expect(ai_task.reload).to be_completed
      expect(ai_task.subject).to eq(job)
    end
  end

  it "rejects an unknown status" do
    result = described_class.call(message: result_message("exploded"))

    expect(result).not_to be_success
    expect(ai_task.reload).to be_queued
  end

  it "rejects a result for an unknown task" do
    result = described_class.call(message: { "ai_task_id" => SecureRandom.uuid, "status" => "completed" })

    expect(result).not_to be_success
  end
end

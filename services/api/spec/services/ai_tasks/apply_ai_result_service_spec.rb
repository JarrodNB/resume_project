# Description: Applying ai_results messages, including duplicate (redelivered) messages and the
# Job a completed scrape_job saves.
require "rails_helper"

RSpec.describe AiTasks::ApplyAiResultService do
  let(:ai_task) { create(:ai_task) }

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  # Builds a result message for ai_task with string keys, as parsed from JSON.
  def result_message(status, **fields)
    { "ai_task_id" => ai_task.id, "status" => status }.merge(fields.stringify_keys)
  end

  it "completes the task and notifies subscribers" do
    result = described_class.call(message: result_message("completed", result: { "echo" => "hi" }))

    expect(result).to be_success
    expect(ai_task.reload).to be_completed
    expect(ai_task.result).to eq("echo" => "hi")
    expect(ai_task.completed_at).to be_present
    expect(ApiSchema.subscriptions).to have_received(:trigger)
      .with(:ai_task_updated, { id: ai_task.id }, ai_task)
  end

  it "ignores a duplicate result for a finished task" do
    described_class.call(message: result_message("completed", result: { "attempt" => 1 }))
    result = described_class.call(message: result_message("completed", result: { "attempt" => 2 }))

    expect(result).to be_success
    expect(ai_task.reload.result).to eq("attempt" => 1)
    expect(ApiSchema.subscriptions).to have_received(:trigger).once
  end

  it "ignores a late result for a failed task" do
    described_class.call(message: result_message("failed", error_message: "Model timed out"))
    described_class.call(message: result_message("completed", result: { "echo" => "late" }))

    expect(ai_task.reload).to be_failed
    expect(ai_task.result).to be_nil
    expect(ai_task.error_message).to eq("Model timed out")
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

    it "fails the task when the job can't be saved" do
      described_class.call(
        message: result_message("completed", result: { "scraped_job" => scraped_job.merge("title" => "") })
      )

      expect(ai_task.reload).to be_failed
      expect(ai_task.error_message).to eq("We couldn't save this job: Title can't be blank")
      expect(ai_task.user.jobs).to be_empty
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

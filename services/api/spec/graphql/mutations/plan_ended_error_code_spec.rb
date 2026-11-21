# Description: AI-start mutations tell the web app a user's ended trial with errorCode PLAN_ENDED, never with
# message text; every other outcome leaves errorCode null.
require "rails_helper"

RSpec.describe "errorCode on AI-start mutations" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }

  before do
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    allow(ApiSchema.subscriptions).to receive(:trigger)
    allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: :accepted, errors: []))
    create(:skill, user: user)
    create(:ai_task, user: user, subject: job, task_type: "analyze_gaps", status: "completed", result: { "gap_analysis" => { "summary" => "Close." } })
  end

  def run(field, query, variables)
    execute_graphql("mutation($id: ID!) { #{field}(input: #{query}) { errors errorCode } }", user: user, variables: variables)
      .dig("data", field)
  end

  {
    "analyzeJobGaps" => ->(job, _chat) { [ "{ jobId: $id }", { id: job.id } ] },
    "startResumeTailoring" => ->(job, _chat) { [ "{ jobId: $id }", { id: job.id } ] },
    "sendChatMessage" => ->(_job, chat) { [ '{ conversationId: $id, message: "Hi", idempotencyKey: "k" }', { id: chat.id } ] }
  }.each do |field, inputs|
    describe field do
      let(:chat) { user.chat_conversations.create! }

      it "returns PLAN_ENDED once the trial has ended" do
        user.update!(trial_ends_at: 1.minute.ago)
        query, variables = inputs.call(job, chat)

        payload = run(field, query, variables)

        expect(payload["errors"]).not_to be_empty
        expect(payload["errorCode"]).to eq("PLAN_ENDED")
      end

      it "returns no errorCode when the user may start AI work" do
        query, variables = inputs.call(job, chat)

        payload = run(field, query, variables)

        expect(payload).to eq("errors" => [], "errorCode" => nil)
      end
    end
  end

  it "returns no errorCode for a refusal that is not about the plan" do
    allow(AiUsage::DailySpend).to receive(:known_microdollars).and_return(10**12)

    payload = run("analyzeJobGaps", "{ jobId: $id }", { id: job.id })

    expect(payload["errors"]).not_to be_empty
    expect(payload["errorCode"]).to be_nil
  end
end

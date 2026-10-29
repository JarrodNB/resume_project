# Check preference dialogue through owned GraphQL requests and queued acceptance.
require "rails_helper"

RSpec.describe "Next-job preference conversation" do
  let(:user) { create(:user) }
  let(:queue) { double("queue", send_message: nil) }
  before { allow(Shoryuken::Client).to receive(:queues).and_return(queue) }

  def start(message = "I want fully remote work", version: 0, previous: nil, owner: user)
    execute_graphql(<<~GQL, user: owner, variables: { message: message, version: version, previous: previous })
      mutation($message: String!, $version: Int!, $previous: ID) {
        startJobPreferenceConversation(input: {message: $message, expectedVersion: $version, previousTaskId: $previous}) {
          aiTask { id status input } errors
        }
      }
    GQL
  end

  def complete(task, status: "completed")
    message = { "ai_task_id" => task.id, "status" => status, "message_history" => [ { "kind" => "response", "parts" => [ { "part_kind" => "text", "content" => "Draft ready" } ] } ],
      "result" => { "reply" => "Review these preferences before confirming.", "criteria" => [ { "text" => "Fully remote work", "priority" => "must_have" } ] } }
    message["pending_questions"] = [ { "id" => "q1", "question" => "Where can you work?" } ] if status == "needs_user_input"
    AiTasks::ApplyAiResultService.call(message: message)
  end

  it "queues one owned turn and saves only an editable draft after a valid completion" do
    payload = start.dig("data", "startJobPreferenceConversation")
    expect(payload).to include("errors" => [])
    task = user.ai_tasks.find(payload.dig("aiTask", "id"))
    complete(task)
    expect(user.reload.job_preference_profile).to have_attributes(version: 1, confirmed_revision: 0, confirmed_criteria: [])
    expect(user.job_preference_profile.draft_criteria.first).to include("text" => "Fully remote work", "priority" => "must_have")
    expect(task.reload.message_history).not_to be_empty
    complete(task)
    expect(user.job_preference_profile.reload.version).to eq(1)
  end
end

RSpec.describe "Preference conversation recovery and fencing" do
  let(:user) { create(:user) }
  let(:queue) { double("queue", send_message: nil) }
  before { allow(Shoryuken::Client).to receive(:queues).and_return(queue) }

  def start(user, message: "Remote is required", version: 0, previous: nil)
    JobPreferences::StartConversationService.call(user: user, message: message, expected_version: version, previous_task_id: previous)
  end

  def paused(task)
    { "ai_task_id" => task.id, "status" => "needs_user_input", "message_history" => [ { "kind" => "response", "parts" => [ { "part_kind" => "tool-call", "tool_name" => "ask_user", "tool_call_id" => "q", "args" => { "question" => "Which location?" } } ] } ],
      "pending_questions" => [ { "id" => "q", "question" => "Which location?" } ] }
  end

  it "reuses duplicate turns, resumes private history and preserves accepted pause on late delivery" do
    task = start(user).value
    expect(start(user).value.id).to eq(task.id)
    message = paused(task)
    AiTasks::ApplyAiResultService.call(message: message)
    child = start(user, message: "United States", previous: task.id).value
    expect(child.input["history"]).to eq(message["message_history"])
    expect(child.input["question_id"]).to eq("q")
    expect(start(user, message: "United States", previous: task.id).value.id).to eq(child.id)
    expect(start(user, message: "Different", previous: task.id)).not_to be_success
    AiTasks::ApplyAiResultService.call(message: message.merge("pending_questions" => [ { "id" => "late", "question" => "Old retry" } ]))
    expect(task.reload.pending_questions.first["id"]).to eq("q")
    expect(start(create(:user), previous: task.id)).not_to be_success
    result = execute_graphql("query { jobPreferenceConversation { turns { userMessage assistantMessage } aiTask { input } } }", user: user)
    expect(result.dig("data", "jobPreferenceConversation", "turns")).to eq([ { "userMessage" => "Remote is required", "assistantMessage" => "Which location?" } ])
    expect(result.dig("data", "jobPreferenceConversation", "aiTask", "input")).not_to have_key("history")
    expect(execute_graphql("query { jobPreferenceConversation { aiTask { id } turns { userMessage } } }", user: create(:user)).dig("data", "jobPreferenceConversation", "aiTask")).to be_nil
  end

  it "rejects late proposals after manual changes, confirmation, or clearing" do
    [ :save_draft, :confirm, :clear ].each do |action|
      owner = create(:user)
      task = start(owner).value
      JobPreferences::UpdateProfileService.call(user: owner, expected_version: 0, action: action,
        criteria: [ { text: "Keep this manual preference", priority: "must_have" } ])
      message = paused(task).merge("status" => "completed", "result" => { "reply" => "Review this", "criteria" => [ { "text" => "Old generated text", "priority" => "must_have" } ] })
      AiTasks::ApplyAiResultService.call(message: message)
      expect(task.reload).to be_failed
      expect(owner.reload.job_preference_profile.version).to eq(1)
      expect(owner.job_preference_profile.draft_criteria.map { |v| v["text"] }).not_to include("Old generated text")
    end
  end

  it "rejects malformed proposals and does not turn history into public input" do
    task = start(user).value
    message = paused(task).merge("status" => "completed", "result" => { "reply" => "Review", "criteria" => [ { "text" => "", "priority" => "invented" } ] })
    AiTasks::ApplyAiResultService.call(message: message)
    expect(task.reload).to be_failed
    expect(user.reload.job_preference_profile).to be_nil
    expect(task.message_history).to eq([])
  end
  it "rejects malformed history and question identities before making history reusable" do
    [
      paused(start(create(:user)).value).merge("message_history" => [ { "kind" => "request", "parts" => "bad" } ]),
      paused(start(create(:user)).value).merge("pending_questions" => [ { "id" => "foreign-tool", "question" => "Which location?" } ]),
      paused(start(create(:user)).value).merge("status" => "completed", "message_history" => [ { "kind" => "invented", "parts" => [] } ],
        "result" => { "reply" => "Review", "criteria" => [] })
    ].each do |message|
      AiTasks::ApplyAiResultService.call(message: message)
      task = AiTask.find(message["ai_task_id"])
      expect(task).to be_failed
      expect(task.message_history).to eq([])
      expect(task.user.job_preference_profile).to be_nil
    end
  end

  it "can start fresh after a clear even when an old task is still queued" do
    old = start(user).value
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 0, action: :clear)
    fresh = start(user, message: "Climate is preferred", version: 1)
    expect(fresh).to be_success
    expect(fresh.value.id).not_to eq(old.id)
    AiTasks::ApplyAiResultService.call(message: paused(old))
    expect(old.reload).to be_failed
    expect(user.reload.job_preference_profile.version).to eq(1)
  end

  it "requires authentication to read preference dialogue" do
    result = execute_graphql("query { jobPreferenceConversation { stale } }", user: nil)
    expect(result["errors"].first["message"]).to eq("Authentication required")
  end
end

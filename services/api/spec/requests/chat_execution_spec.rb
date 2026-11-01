# Exercise service authentication and fenced chat callbacks over the private HTTP interface.
require "rails_helper"
RSpec.describe "Chat execution callbacks", type: :request do
  let(:user) { create(:user) }
  let(:chat) { user.chat_conversations.create! }
  let(:operation) { Chat::StartMessageService.call(conversation: chat, message: "Find a career direction", idempotency_key: "request").value }
  let(:headers) { { "Authorization" => "Bearer chat-secret" } }
  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("AI_EXECUTION_SERVICE_SECRET").and_return("chat-secret")
    allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: :accepted, errors: []))
  end

  def path(action = nil)
    "/internal/chat/operations/#{operation.id}#{action ? "/#{action}" : ''}"
  end

  it "rejects missing or fallback credentials before resolving any private operation" do
    post path("claim"), params: {}, as: :json
    expect(response).to have_http_status(:unauthorized)
    post path("claim"), params: {}, as: :json, headers: { "Authorization" => "Bearer wrong" }
    expect(response).to have_http_status(:unauthorized)
    expect(operation.reload).to be_pending
    get path, headers: headers
    expect(response).to have_http_status(:ok)
    expect(response.headers["Cache-Control"]).to eq("no-store")
  end

  it "claims, screens and accepts exact input while preserving callback idempotency" do
    post path("claim"), params: {}, as: :json, headers: headers
    expect(response).to have_http_status(:ok)
    claim = response.parsed_body
    expect(claim.dig("payload", "user_id")).to eq(user.id)
    expect(claim.dig("payload", "max_input_characters")).to eq(10_000)
    expect(claim.fetch("payload").keys).to contain_exactly("version", "conversation_id", "user_id", "expected_position",
      "summary_base_version", "summary_through_position", "summary_plan", "max_input_characters", "summarize_every_user_messages")
    expect(response.body).not_to include(operation.message)
    identity = claim.slice("attempt_id", "claim_generation")
    post path("heartbeat"), params: identity, as: :json, headers: headers
    expect(response).to have_http_status(:ok)
    post path("accept"), params: identity.merge(reply: "Consider the work you enjoy.", screened_message_sha256: Digest::SHA256.hexdigest(operation.message)), as: :json, headers: headers
    expect(response).to have_http_status(:ok)
    ids = response.parsed_body.fetch("message_ids")
    post path("accept"), params: identity.merge(reply: "Consider the work you enjoy.", screened_message_sha256: Digest::SHA256.hexdigest(operation.message)), as: :json, headers: headers
    expect(response.parsed_body.fetch("message_ids")).to eq(ids)
    expect(chat.messages.count).to eq(2)
    get path, headers: headers
    expect(response.parsed_body.fetch("status")).to eq("accepted")
  end

  it "does not accept missing identity, stale generation, mismatched screening or oversized replies" do
    post path("claim"), params: {}, as: :json, headers: headers
    identity = response.parsed_body.slice("attempt_id", "claim_generation")
    post path("accept"), params: { reply: "Answer" }, as: :json, headers: headers
    expect(response).to have_http_status(:unprocessable_content)
    args = identity.merge(reply: "Answer", screened_message_sha256: "wrong")
    post path("accept"), params: args, as: :json, headers: headers
    expect(response).to have_http_status(:conflict)
    args["screened_message_sha256"] = Digest::SHA256.hexdigest(operation.message)
    post path("accept"), params: args.merge("claim_generation" => identity["claim_generation"] + 1), as: :json, headers: headers
    expect(response).to have_http_status(:conflict)
    post path("accept"), params: args.merge(reply: "x" * 8001), as: :json, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(chat.messages).to be_empty
  end

  it "accepts the private versioned summary update with the reply in one transaction" do
    (1..19).each do |turn|
      text = "Accepted career fact #{turn}"
      chat.messages.create!(role: "user", position: turn * 2 - 1, content: text, screened_sha256: Digest::SHA256.hexdigest(text))
      chat.messages.create!(role: "assistant", position: turn * 2, content: "Accepted reply #{turn}")
    end
    post path("claim"), params: {}, as: :json, headers: headers
    expect(response).to have_http_status(:ok)
    claim = response.parsed_body
    expect(claim.dig("payload", "summary_plan")).to eq("through_position" => 30, "scheduled" => true)
    args = claim.slice("attempt_id", "claim_generation").merge(reply: "Next step", screened_message_sha256: Digest::SHA256.hexdigest(operation.message),
      summary_update: { text: "Earlier career facts", expected_version: 0, through_position: 30 })
    post path("accept"), params: args, as: :json, headers: headers
    expect(response).to have_http_status(:ok)
    expect(chat.reload.summary_version).to eq(1)
    expect(chat.summary_through_position).to eq(30)
    expect(chat.messages.count).to eq(40)
    post path("accept"), params: args, as: :json, headers: headers
    expect(response).to have_http_status(:ok)
    expect(chat.reload.summary_version).to eq(1)
  end

  it "accepts bounded exact library checks through the private HTTP callback" do
    skill = create(:skill, user: user, name: "Ruby", screened_fields: [])
    post path("claim"), params: {}, as: :json, headers: headers
    identity = response.parsed_body.slice("attempt_id", "claim_generation")
    report = { record_type: "skill", record_id: skill.id, fields: ["name"],
      fingerprints: { name: Digest::SHA256.hexdigest(JSON.generate("Ruby")) } }
    post path("accept"), params: identity.merge(reply: "You list Ruby.",
      screened_message_sha256: Digest::SHA256.hexdigest(operation.message), record_screening: [report]), as: :json, headers: headers
    expect(response).to have_http_status(:ok)
    expect(skill.reload.screened_fields).to eq(["name"])
  end

  it "accepts record_screening receipts through the private HTTP callback" do
    skill = create(:skill, user: user, name: "Ruby", screened_fields: [])
    post path("claim"), params: {}, as: :json, headers: headers
    identity = response.parsed_body.slice("attempt_id", "claim_generation")
    receipt = { record_type: "skill", record_id: skill.id, revision: {},
      fingerprints: { name: Digest::SHA256.hexdigest(JSON.generate("Ruby")) } }
    args = identity.merge(reply: "You list Ruby.",
      screened_message_sha256: Digest::SHA256.hexdigest(operation.message), record_screening: [receipt])
    post path("accept"), params: args, as: :json, headers: headers
    expect(response).to have_http_status(:ok)
    expect(skill.reload.screened_fields).to eq(["name"])
    post path("accept"), params: args, as: :json, headers: headers
    expect(response).to have_http_status(:ok)
  end

  it "saves proposed career context atomically and replays without duplicate embedding work" do
    post path("claim"), params: {}, as: :json, headers: headers
    args = response.parsed_body.slice("attempt_id", "claim_generation").merge(reply: "Saved your example.",
      screened_message_sha256: Digest::SHA256.hexdigest(operation.message),
      career_context: { requirement: "Leading an incident", response: "I coordinated the recovery." })
    expect {
      post path("accept"), params: args, as: :json, headers: headers
    }.to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob).once
    expect(response).to have_http_status(:ok)
    expect(user.career_contexts.pluck(:requirement, :response)).to eq([["Leading an incident", "I coordinated the recovery."]])
    expect(chat.messages.count).to eq(2)
    expect { post path("accept"), params: args, as: :json, headers: headers }.not_to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob)
    expect(response).to have_http_status(:ok)
    expect(user.career_contexts.count).to eq(1)
    post path("accept"), params: args.merge(career_context: { requirement: "Other", response: "Other fact" }), as: :json, headers: headers
    expect(response).to have_http_status(:conflict)
  end

  [
    { requirement: "", response: "Fact" },
    { requirement: "Topic", response: "x" * 4001 },
    { requirement: "Topic", response: "Fact", user_id: "other" },
    [{ requirement: "Topic", response: "Fact" }]
  ].each do |proposal|
    it "rejects malformed save #{proposal.class} without accepting dialogue" do
      post path("claim"), params: {}, as: :json, headers: headers
      args = response.parsed_body.slice("attempt_id", "claim_generation").merge(reply: "Saved.",
        screened_message_sha256: Digest::SHA256.hexdigest(operation.message), career_context: proposal)
      post path("accept"), params: args, as: :json, headers: headers
      expect(response).to have_http_status(:conflict)
      expect(user.career_contexts).to be_empty
      expect(chat.messages).to be_empty
    end
  end

  it "does not overwrite an existing topic or accept a stale save" do
    context = create(:career_context, user: user, requirement: "Topic", response: "Original")
    post path("claim"), params: {}, as: :json, headers: headers
    args = response.parsed_body.slice("attempt_id", "claim_generation").merge(reply: "Saved.",
      screened_message_sha256: Digest::SHA256.hexdigest(operation.message), career_context: { requirement: "Topic", response: "Changed" })
    post path("accept"), params: args, as: :json, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(context.reload.response).to eq("Original")
    expect(chat.messages).to be_empty
    operation.update!(lease_expires_at: 1.minute.ago)
    args[:career_context] = { requirement: "New", response: "Fact" }
    post path("accept"), params: args, as: :json, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(user.career_contexts.count).to eq(1)
  end

  it "recognizes an exact existing entry without another embedding job and scopes to the owner" do
    create(:career_context, requirement: "Topic", response: "Foreign fact")
    context = create(:career_context, user: user, requirement: "Topic", response: "Owned fact")
    post path("claim"), params: {}, as: :json, headers: headers
    args = response.parsed_body.slice("attempt_id", "claim_generation").merge(reply: "Already saved.",
      screened_message_sha256: Digest::SHA256.hexdigest(operation.message), career_context: { requirement: "Topic", response: "Owned fact" })
    expect { post path("accept"), params: args, as: :json, headers: headers }.not_to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob)
    expect(response).to have_http_status(:ok)
    expect(user.career_contexts.pluck(:id)).to eq([context.id])
  end

  it "rolls back the save when accepting dialogue fails" do
    post path("claim"), params: {}, as: :json, headers: headers
    args = response.parsed_body.slice("attempt_id", "claim_generation").merge(reply: "Saved.",
      screened_message_sha256: Digest::SHA256.hexdigest(operation.message), career_context: { requirement: "Topic", response: "Fact" })
    allow_any_instance_of(ChatMessage).to receive(:save!).and_raise(ActiveRecord::RecordInvalid)
    post path("accept"), params: args, as: :json, headers: headers
    expect(response).not_to have_http_status(:ok)
    expect(user.career_contexts).to be_empty
    expect(chat.messages).to be_empty
  end

  it "does not accept a save after the library fills during generation" do
    now = Time.current
    CareerContext.insert_all!((1..100).map { |n| { user_id: user.id, requirement: "Topic #{n}", response: "Fact", created_at: now, updated_at: now } })
    post path("claim"), params: {}, as: :json, headers: headers
    args = response.parsed_body.slice("attempt_id", "claim_generation").merge(reply: "Saved.",
      screened_message_sha256: Digest::SHA256.hexdigest(operation.message), career_context: { requirement: "New", response: "Fact" })
    post path("accept"), params: args, as: :json, headers: headers
    expect(response).to have_http_status(:conflict)
    expect(user.career_contexts.count).to eq(100)
    expect(chat.messages).to be_empty
  end

end

# Exercises the public live interview interface: choosing live at start and joining a LiveKit room.
require "rails_helper"

RSpec.describe "Live interview GraphQL" do
  let(:user) { create(:user, summary: "I maintain laboratory instruments.") }

  before { allow(Interviews::RuntimeReadiness).to receive(:ready?).and_return(true) }

  it "starts a live preparation and exposes the saved conversation mode" do
    query = 'mutation($input: StartInterviewInput!) { startInterview(input: $input) { interview { id conversationMode setup { questionCount } } errors } }'
    result = execute_graphql(query, user: user, variables: { input: { conversationMode: "LIVE", setup: { questionCount: 5 } } })
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "startInterview", "interview")).to include("conversationMode" => "LIVE", "setup" => { "questionCount" => 5 })
    expect(user.interview_sessions.sole.conversation_mode).to eq("live")
    default = execute_graphql(query, user: user, variables: { input: {} })
    expect(default.dig("data", "startInterview", "interview", "conversationMode")).to eq("TURN_BASED")
    unknown = execute_graphql(query, user: user, variables: { input: { conversationMode: "video" } })
    expect(unknown.dig("errors", 0, "message")).to include("conversationMode")
    refused = execute_graphql(query, user: user, variables: { input: { conversationMode: "LIVE", setup: { questionCount: 12 } } })
    expect(refused.dig("data", "startInterview", "interview")).to be_nil
    expect(refused.dig("data", "startInterview", "errors")).to eq([ "Live interviews use 5 or 8 questions" ])
  end

  it "starts a turn-based interview with a live session's own setup, job and career focus, for its owner only" do
    job = create(:job, user: user)
    setup = { "question_count" => 5, "question_format" => "behavioral", "difficulty" => "stretch", "interviewer" => "maya", "focus_areas" => [ "leadership" ] }
    source = Interviews::StartPreparationService.call(user: user, setup: setup, job: job, career_focus: "Calibration", conversation_mode: "live").value
    query = 'mutation($input: StartInterviewInput!) { startInterview(input: $input) { interview { id conversationMode jobContext { id } } errors } }'
    variables = { input: { fromInterviewId: source.id, conversationMode: "TURN_BASED" } }
    expect(execute_graphql(query, user: create(:user), variables: variables).dig("errors", 0, "message")).to eq("Record not found")
    result = execute_graphql(query, user: user, variables: variables)
    expect(result.dig("data", "startInterview")).to include("errors" => [],
      "interview" => include("conversationMode" => "TURN_BASED", "jobContext" => { "id" => job.id }))
    started = user.interview_sessions.find(result.dig("data", "startInterview", "interview", "id"))
    expect(started).to have_attributes(setup_config: source.setup_config, career_focus: "Calibration", job: job)
    mixed = execute_graphql(query, user: user, variables: { input: { fromInterviewId: source.id, setup: { questionCount: 8 } } })
    expect(mixed.dig("data", "startInterview")).to include("interview" => nil,
      "errors" => [ "Start from an earlier interview or with new settings, not both" ])
  end

  describe "joinLiveInterview" do
    let(:join) { 'mutation($input: JoinLiveInterviewInput!) { joinLiveInterview(input: $input) { url token roomName expiresAt interview { id status messages { id } } errors } }' }

    around { |example| with_livekit_env { example.run } }

    it "returns LiveKit join details only to the owner of a live interview" do
      interview = ready_live_interview(user)
      variables = { input: { interviewId: interview.id } }
      expect(execute_graphql(join, user: create(:user), variables: variables).dig("errors", 0, "message")).to eq("Record not found")
      expect(execute_graphql(join, user: nil, variables: variables).dig("errors", 0, "message")).to eq("Authentication required")
      result = execute_graphql(join, user: user, variables: variables)
      expect(result["errors"]).to be_nil
      payload = result.dig("data", "joinLiveInterview")
      expect(payload).to include("url" => "wss://live.example.test", "errors" => [],
        "roomName" => interview.live_connections.sole.room_name, "interview" => { "id" => interview.id, "status" => "active", "messages" => [] })
      expect(decode_livekit_token(payload["token"]).dig("video", "room")).to eq(payload["roomName"])
      expect(Time.iso8601(payload["expiresAt"])).to be_within(1.minute).of(10.minutes.from_now)
    end

    it "refuses a new room with fewer than 5 live minutes left, naming the reason, and reuses an open one" do
      interview = ready_live_interview(user)
      variables = { input: { interviewId: interview.id } }
      allow(Interviews::LiveAllowance).to receive(:remaining_seconds).and_return(299)
      refused = execute_graphql(join, user: user, variables: variables)
      expect(refused.dig("data", "joinLiveInterview")).to include("token" => nil, "interview" => nil,
        "errors" => [ "You need at least 5 live minutes to start a live interview. You have 4 minutes left." ])
      expect(execute_graphql('mutation($input: JoinLiveInterviewInput!) { joinLiveInterview(input: $input) { errorCode } }', user: user,
        variables: variables).dig("data", "joinLiveInterview", "errorCode")).to eq("LIVE_ALLOWANCE_LOW")
      expect(interview.reload).to have_attributes(status: "ready")
      expect(interview.live_connections).to be_empty

      allow(Interviews::LiveAllowance).to receive(:remaining_seconds).and_return(300)
      expect(execute_graphql(join, user: user, variables: variables).dig("data", "joinLiveInterview", "errors")).to eq([])
      allow(Interviews::LiveAllowance).to receive(:remaining_seconds).and_return(60)
      rejoin = execute_graphql(join, user: user, variables: variables).dig("data", "joinLiveInterview")
      expect(rejoin).to include("errors" => [], "roomName" => interview.live_connections.sole.room_name)
    end

    it "refuses turn-based interviews with an error result" do
      interview = ready_live_interview(user, conversation_mode: "turn_based")
      result = execute_graphql(join, user: user, variables: { input: { interviewId: interview.id } })
      expect(result.dig("data", "joinLiveInterview")).to include("token" => nil, "interview" => nil, "errors" => [ "This interview is not a live interview" ])
    end
  end

  it "shows the viewer their live seconds left and refuses a live preparation below 5 minutes" do
    query = '{ me { liveInterviewSecondsLeft } }'
    expect(execute_graphql(query, user: user).dig("data", "me", "liveInterviewSecondsLeft")).to eq(600)
    allow(Interviews::LiveAllowance).to receive(:remaining_seconds).and_return(240)
    start = 'mutation($input: StartInterviewInput!) { startInterview(input: $input) { interview { id } errors errorCode } }'
    refused = execute_graphql(start, user: user, variables: { input: { conversationMode: "LIVE", setup: { questionCount: 5 } } })
    expect(refused.dig("data", "startInterview")).to include("interview" => nil, "errorCode" => "LIVE_ALLOWANCE_LOW",
      "errors" => [ "You need at least 5 live minutes to start a live interview. You have 4 minutes left." ])
    turn_based = execute_graphql(start, user: user, variables: { input: { setup: { questionCount: 5 } } })
    expect(turn_based.dig("data", "startInterview", "errors")).to eq([])
    expect(user.interview_sessions.pluck(:conversation_mode)).to eq([ "turn_based" ])
  end

  it "shows the owner each question's saved live feedback, and nothing for questions without it" do
    interview = ready_live_interview(user)
    interview.questions.find_by!(position: 0).update!(live_feedback: "Quick feedback: clear example. Lead with the result.")
    query = 'query($id: ID!) { interviewSession(id: $id) { questions { position liveFeedback } } }'
    expect(execute_graphql(query, user: create(:user), variables: { id: interview.id }).dig("data", "interviewSession")).to be_nil
    questions = execute_graphql(query, user: user, variables: { id: interview.id }).dig("data", "interviewSession", "questions")
    expect(questions.find { |question| question["position"] == 0 }["liveFeedback"]).to eq("Quick feedback: clear example. Lead with the result.")
    expect(questions.find { |question| question["position"] == 1 }["liveFeedback"]).to be_nil
  end

  describe "endLiveInterview" do
    let(:end_live) { 'mutation($input: EndLiveInterviewInput!) { endLiveInterview(input: $input) { interview { id status } errors } }' }

    around { |example| with_livekit_env { example.run } }

    it "finishes the owner's live interview when the agent is gone: completed with an answer, the same on repeat" do
      interview = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: interview)
      question = interview.questions.first
      interview.messages.create!(question: question, kind: "opening", position: 0, semantic_key: "question:#{question.id}:opening", content: question.content)
      interview.messages.create!(question: question, kind: "answer", position: 1, semantic_key: "live_answer:x", content: "My answer.")
      variables = { input: { interviewId: interview.id } }
      expect(execute_graphql(end_live, user: create(:user), variables: variables).dig("errors", 0, "message")).to eq("Record not found")
      result = execute_graphql(end_live, user: user, variables: variables)
      expect(result.dig("data", "endLiveInterview")).to eq("interview" => { "id" => interview.id, "status" => "completed" }, "errors" => [])
      expect(interview.live_connections.sole).to have_attributes(status: "ended", end_reason: "ended_by_candidate")
      again = execute_graphql(end_live, user: user, variables: variables)
      expect(again.dig("data", "endLiveInterview", "interview", "status")).to eq("completed")
    end

    it "ends a room the candidate leaves for the turn-based fallback as failed, so it never stays active" do
      interview = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: interview)
      result = execute_graphql(end_live, user: user, variables: { input: { interviewId: interview.id, liveUnavailable: true } })
      expect(result.dig("data", "endLiveInterview", "interview", "status")).to eq("abandoned")
      expect(interview.live_connections.sole).to have_attributes(status: "ended", end_reason: "failed")
    end

    it "refuses ending an interview that is no longer active with a message, never the agent's internal code" do
      interview = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: interview)
      interview.update_columns(status: "completed") # finished another way while its room stayed open
      query = 'mutation($input: EndLiveInterviewInput!) { endLiveInterview(input: $input) { interview { id } errors errorCode } }'
      result = execute_graphql(query, user: user, variables: { input: { interviewId: interview.id } })
      expect(result["errors"]).to be_nil
      expect(result.dig("data", "endLiveInterview")).to eq("interview" => nil, "errors" => [ "Interview is not active" ], "errorCode" => nil)
    end

    it "abandons a live interview with no answers, also one whose room was never joined" do
      interview = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: interview)
      result = execute_graphql(end_live, user: user, variables: { input: { interviewId: interview.id } })
      expect(result.dig("data", "endLiveInterview", "interview", "status")).to eq("abandoned")
      never_joined = ready_live_interview(user)
      result = execute_graphql(end_live, user: user, variables: { input: { interviewId: never_joined.id, liveUnavailable: true } })
      expect(result.dig("data", "endLiveInterview")).to include("interview" => include("status" => "abandoned"), "errors" => [])
    end
  end

  describe "turn-based actions on a live interview" do
    around { |example| with_livekit_env { example.run } }

    let(:interview) do
      interview = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: interview)
      question = interview.questions.first
      interview.messages.create!(question: question, kind: "opening", position: 0, semantic_key: "question:#{question.id}:opening", content: question.content)
      interview.reload
    end
    let(:question_id) { interview.questions.first.id }
    let(:message_id) { interview.messages.sole.id }

    def errors_of(field, mutation, input)
      execute_graphql(mutation, user: user, variables: { input: { interviewId: interview.id, **input } }).dig("data", field, "errors")
    end

    it "refuses submitting, skipping and every way of capturing an answer, starting no work" do
      revision = interview.revision
      refusals = {
        "submitInterviewTurn" => [ "mutation($input: SubmitInterviewTurnInput!) { submitInterviewTurn(input: $input) { errors } }",
          { questionId: question_id, expectedRevision: revision, submissionKey: "typed", transcriptionMode: "typed", candidateTranscript: "My answer." } ],
        "skipInterviewQuestion" => [ "mutation($input: SkipInterviewQuestionInput!) { skipInterviewQuestion(input: $input) { errors } }",
          { questionId: question_id, expectedRevision: revision, submissionKey: "skip" } ],
        "authorizeInterviewTranscription" => [ "mutation($input: AuthorizeInterviewTranscriptionInput!) { authorizeInterviewTranscription(input: $input) { errors } }",
          { questionId: question_id, expectedRevision: revision } ],
        "authorizeInterviewRecording" => [ "mutation($input: AuthorizeInterviewRecordingInput!) { authorizeInterviewRecording(input: $input) { errors } }",
          { questionId: question_id, expectedRevision: revision, contentType: "audio/webm", byteSize: 1_000, checksum: Base64.strict_encode64(Digest::MD5.digest("x")) } ],
        "startRecordedTranscription" => [ "mutation($input: StartRecordedTranscriptionInput!) { startRecordedTranscription(input: $input) { errors } }",
          { questionId: question_id, expectedRevision: revision, recordingId: SecureRandom.uuid } ],
        "requestInterviewClarification" => [ "mutation($input: RequestInterviewClarificationInput!) { requestInterviewClarification(input: $input) { errors } }",
          { messageId: message_id } ],
        "avoidInterviewPrompt" => [ "mutation($input: AvoidInterviewPromptInput!) { avoidInterviewPrompt(input: $input) { errors } }",
          { messageId: message_id } ]
      }
      refusals.each do |field, (mutation, input)|
        expect(errors_of(field, mutation, input)).to eq([ "This is a live interview" ]), field
      end
      expect(interview.reload).to have_attributes(status: "active", revision: revision)
      expect(interview.operations.where.not(kind: "preparation")).to be_empty
      expect(interview.clarifications).to be_empty
      expect(InterviewTranscriptionCapture.where(interview_session: interview)).to be_empty
      expect(InterviewSessionMedia.where(interview_session: interview)).to be_empty
    end
  end
end

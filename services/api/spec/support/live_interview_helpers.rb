# Builds prepared live interviews and LiveKit settings for live interview specs.
module LiveInterviewHelpers
  LIVEKIT_TEST_ENV = { "LIVEKIT_URL" => "wss://live.example.test", "LIVEKIT_API_KEY" => "test-key",
    "LIVEKIT_API_SECRET" => "test-secret-that-is-long-enough-for-hs256" }.freeze

  # A ready live session with eight prepared questions, as preparation leaves it.
  def ready_live_interview(user, conversation_mode: "live")
    interview = Interviews::StartPreparationService.call(user: user, conversation_mode: conversation_mode).value
    operation = interview.operations.first
    claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value
    role = { "title" => "Laboratory technician", "responsibilities" => [ "Maintain instruments" ], "requirements" => [ "Calibration" ] }
    questions = 8.times.map { |i| { "question_type" => %w[behavioral technical knowledge][i % 3], "content" => "Laboratory question #{i}?" } }
    Interviews::AcceptPreparationService.call(operation: operation, attempt_id: claim[:attempt_id],
      claim_generation: claim[:claim_generation], role: role, questions: questions)
    interview.reload
  end

  def with_livekit_env(values = LIVEKIT_TEST_ENV)
    previous = values.keys.index_with { |key| ENV[key] }
    values.each { |key, value| ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| ENV[key] = value }
  end

  def decode_livekit_token(token, secret: LIVEKIT_TEST_ENV.fetch("LIVEKIT_API_SECRET"))
    JWT.decode(token, secret, true, algorithm: "HS256").first
  end
end

RSpec.configure { |config| config.include LiveInterviewHelpers }

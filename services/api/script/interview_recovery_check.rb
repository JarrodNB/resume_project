# Drives fictional recovery checks against real Rails/Postgres and private S3 objects.
# The companion shell script owns process kills; this runner owns assertions and fixtures.
require "net/http"
require "digest"

raise "Development fake check only" unless Rails.env.development? && ENV["INTERVIEW_SERVICE_SECRET"].present?
run_id = ENV.fetch("CHECK_RUN_ID")
raise "Invalid check identity" unless run_id.match?(/\A[a-z0-9-]{1,60}\z/)
email = "recovery-#{run_id}@example.invalid"

def checked(result)
  raise result.errors.inspect unless result.success?
  result.value
end

def assert_check(condition, description)
  raise description unless condition
end

def internal_request(operation, action = nil, values = {}, method: :post, authorized: true)
  path = "/internal/interviews/operations/#{operation.id}"
  path += "/#{action}" if action
  uri = URI("http://api:3000#{path}")
  request = (method == :get ? Net::HTTP::Get : Net::HTTP::Post).new(uri)
  request["Content-Type"] = "application/json"
  request["Authorization"] = "Bearer #{ENV.fetch('INTERVIEW_SERVICE_SECRET')}" if authorized
  request.body = JSON.generate(values) unless method == :get
  Net::HTTP.start(uri.host, uri.port, open_timeout: 3, read_timeout: 10) { |http| http.request(request) }
end

def await_saved(operation)
  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 70
  loop do
    operation.reload
    return if operation.accepted?
    raise "Failed #{operation.kind}: #{operation.failure_code}" if operation.failed? || operation.expired?
    raise "Recovery deadline exceeded" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
    sleep 0.2
  end
end

def recording(interview, invalid: false)
  samples = (0...800).map { |index| (Math.sin(index * Math::PI / 20) * 3000).to_i }.pack("s<*")
  bytes = "RIFF" + [ 36 + samples.bytesize ].pack("V") + "WAVEfmt " +
    [ 16, 1, 1, 8000, 16000, 2, 16 ].pack("VvvVVvv") + "data" + [ samples.bytesize ].pack("V") + samples
  bytes = "RIFF" + [ 4 ].pack("V") + "WAVE" if invalid
  storage = Interviews::MediaStorage.new
  interview.reload
  receipt = checked(Interviews::ReserveRecordingService.call(interview: interview,
    question_id: interview.questions.first.id, expected_revision: interview.revision,
    content_type: "audio/wav", byte_size: bytes.bytesize,
    checksum: Digest::MD5.base64digest(bytes), storage: storage))
  uri = URI(receipt[:upload_url])
  request = Net::HTTP::Put.new(uri, receipt[:headers])
  request.body = bytes
  response = Net::HTTP.start(uri.host, uri.port, open_timeout: 3, read_timeout: 10) { |http| http.request(request) }
  assert_check(response.code == "200", "Real S3 upload failed")
  media = InterviewSessionMedia.find(receipt[:media_id])
  checked(Interviews::RegisterMediaService.call(media: media, storage: storage))
  media
end

def submit(interview, key, invalid: false)
  media = recording(interview, invalid: invalid)
  checked(Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
    recording_id: media.id, expected_revision: interview.revision, submission_key: key))
end

phase = ENV.fetch("CHECK_PHASE")
user = User.find_by(email: email)
if phase == "setup"
  raise "Run identity already exists" if user
  user = User.create!(email: email, password: SecureRandom.base64(30), confirmed_at: Time.current)
  checked(Interviews::CreateFixtureService.call(user: user))
  puts "PASS setup"
  exit
end
raise "Missing check user" unless user
interview = user.interview_sessions.reorder(:created_at, :id).first

case phase
when "opening"
  await_saved(interview.operations.speech.first)
  puts "PASS saved opening speech"
when "submit-first", "submit-second"
  operation = submit(interview, phase)
  puts "OPERATION_ID=#{operation.id}"
when "verify-first"
  turn = interview.operations.turn.find_by!(submission_key: "submit-first")
  await_saved(turn)
  await_saved(interview.operations.speech.order(:created_at).last)
  assert_check(turn.reload.execution_count == 2, "Killed execution was not replaced exactly once")
  assert_check(interview.questions.first.reload.accepted_answer_count == 1, "Recovered turn accepted twice")
  assert_check(turn.ai_task.ai_usage_attempts.any?(&:incomplete), "Killed execution lost unknown usage marker")
  assert_check(turn.ai_task.reload.cost_microdollars.zero?, "Fake execution incurred cost")
  old = turn.execution_attempts.order(:created_at).first
  stale = internal_request(turn, "heartbeat", { attempt_id: old.attempt_id, claim_generation: old.claim_generation })
  assert_check(stale.code == "409", "Old claim can still mutate state")
  stale_output = internal_request(turn, "accept", { attempt_id: old.attempt_id,
    claim_generation: old.claim_generation, transcript: "Stale fictional answer", decision: "advance",
    history_version: 1, model_history: [] })
  assert_check(stale_output.code == "409" && interview.messages.answer.count == 1, "Stale output changed accepted dialogue")
  puts "PASS killed before acceptance; expired claim recovered once; stale claim rejected; unknown usage retained"
when "verify-accepted"
  turn = interview.operations.turn.find_by!(submission_key: "submit-second")
  assert_check(turn.accepted? && turn.execution_count == 1, "Acceptance did not survive executor kill")
  assert_check(interview.reload.completed? && interview.questions.first.accepted_answer_count == 2, "Cap/completion missing")
  assert_check(interview.operations.speech.order(:created_at).last.pending?, "Speech was not independently pending")
  puts "PASS killed after acceptance; dialogue complete with independently pending speech"
when "verify-complete"
  await_saved(interview.operations.speech.order(:created_at).last)
  assert_check(interview.operations.turn.sum(:execution_count) == 3, "Speech recovery reran reasoning")
  assert_check(interview.messages.answer.count == 2 && interview.messages.closing.count == 1, "Recovery duplicated dialogue")
  puts "PASS restart discovered pending speech without wakeup or repeated reasoning"
when "prepare-case"
  target = checked(Interviews::CreateFixtureService.call(user: user))
  operation = submit(target, ENV.fetch("CHECK_CASE"), invalid: ENV["CHECK_CASE"] == "invalid")
  puts "OPERATION_ID=#{operation.id}"
when "verify-case"
  name = ENV.fetch("CHECK_CASE")
  turn = InterviewSessionOperation.joins(:interview_session).where(interview_sessions: { user_id: user.id }).find_by!(submission_key: name)
  expected = { "blocked" => "screening_blocked", "unavailable" => "screening_unavailable", "oversized" => "transcript_too_long", "invalid" => "invalid_recording" }[name]
  if expected
    assert_check(turn.failure_code == expected && !turn.accepted?, "Unexpected #{name} outcome: #{turn.status}/#{turn.failure_code}")
    assert_check(turn.question.accepted_answer_count.zero?, "Rejected answer consumed allowance")
    stages = turn.execution_attempts.flat_map { |attempt| attempt.provider_attempts.pluck(:stage) }
    assert_check(!stages.include?("interviewer"), "Rejected input reached interviewer")
    puts "PASS #{name}: #{expected}, no accepted answer or interviewer call"
  else
    assert_check(turn.accepted? && turn.execution_count == 1 && turn.question.accepted_answer_count == 1, "Lost receipt duplicated turn")
    puts "PASS lost real acceptance receipt reconciled through canonical HTTP status"
  end
when "contracts"
  # Race real authenticated HTTP claims while no runtime is competing.
  target = checked(Interviews::CreateFixtureService.call(user: user))
  operation = target.operations.first
  responses = 2.times.map { Thread.new { internal_request(operation, "claim") } }.map(&:value)
  assert_check(responses.map(&:code).sort == %w[200 409], "Competing claims both acquired work")
  assert_check(operation.reload.execution_count == 1, "Claim race created extra execution")
  response = internal_request(operation, nil, {}, method: :get, authorized: false)
  assert_check(response.code == "401", "Internal status accepted unauthenticated caller")
  # Repeat a genuine accepted payload using the exact saved runtime history/identity.
  turn = interview.operations.turn.find_by!(submission_key: "submit-second")
  answer = interview.messages.find_by!(semantic_key: "turn:#{turn.id}:answer")
  payload = { attempt_id: turn.attempt_id, claim_generation: turn.claim_generation,
    transcript: answer.content, decision: "continue", reply: "What changed for the team after you introduced the tool?",
    history_version: turn.question.history_version, model_history: turn.question.model_history }
  response = internal_request(turn, "accept", payload)
  assert_check(response.code == "200", "Identical acceptance replay did not return its saved receipt")
  assert_check(interview.messages.answer.count == 2, "Acceptance replay added an answer")
  # Distinct submissions compete through real database connections and sealed media.
  target = checked(Interviews::CreateFixtureService.call(user: user))
  media = recording(target)
  results = 2.times.map do |index|
    Thread.new do
      ApplicationRecord.connection_pool.with_connection do
        Interviews::SubmitTurnService.call(interview: user.interview_sessions.find(target.id),
          question_id: target.questions.first.id, recording_id: media.id,
          expected_revision: 0, submission_key: "race-#{index}")
      end
    end
  end.map(&:value)
  assert_check(results.count(&:success?) == 1 && target.operations.turn.count == 1, "Competing submissions both started")
  target = checked(Interviews::CreateFixtureService.call(user: user))
  user.update!(monthly_ai_budget_microdollars: 0)
  denied = Interviews::ClaimOperationService.call(operation: target.operations.first)
  assert_check(!denied.success? && target.operations.first.reload.failure_code == "ai_usage_limit_reached", "Budget denial remained silently pending")
  user.update!(monthly_ai_budget_microdollars: nil)
  checked(Interviews::RetryOperationService.call(operation: target.operations.first))
  assert_check(target.operations.first.reload.pending?, "Restored budget cannot explicitly retry")
  target = checked(Interviews::CreateFixtureService.call(user: user))
  expired = submit(target, "expired-source")
  InterviewSessionMedia.find(expired.recording_id).update!(expires_at: 1.second.ago)
  assert_check(internal_request(expired, "claim").code == "409", "Expired recording was executed")
  assert_check(expired.reload.expired? && expired.question.accepted_answer_count.zero?, "Expired recording stayed pending or consumed allowance")
  puts "PASS competing real HTTP claims; credential boundary; accepted state unchanged by replay"
  puts "PASS competing submissions and actionable budget denial with explicit retry"
when "speech-retry"
  turn = InterviewSessionOperation.joins(:interview_session).where(interview_sessions: { user_id: user.id }).find_by!(submission_key: "lost-receipt")
  speech = turn.interview_session.operations.speech.order(:created_at).last
  claim = JSON.parse(internal_request(speech, "claim").body).slice("attempt_id", "claim_generation")
  assert_check(internal_request(speech, "fail", claim.merge(code: "speech_failed", retryable: false)).code == "200", "Speech failure not saved")
  assert_check(internal_request(speech, "retry").code == "200", "Saved speech cannot retry")
  puts "HISTORY_SHA=#{Digest::SHA256.hexdigest(JSON.generate(turn.question.model_history))}"
  puts "OPERATION_ID=#{speech.id}"
when "verify-speech"
  turn = InterviewSessionOperation.joins(:interview_session).where(interview_sessions: { user_id: user.id }).find_by!(submission_key: "lost-receipt")
  speech = turn.interview_session.operations.speech.order(:created_at).last
  assert_check(speech.accepted? && speech.execution_count == 2, "Speech retry did not finish independently")
  assert_check(turn.execution_count == 1 && turn.question.accepted_answer_count == 1 && turn.interview_session.messages.answer.count == 1,
    "Speech retry changed accepted dialogue or reasoning count")
  assert_check(Digest::SHA256.hexdigest(JSON.generate(turn.question.model_history)) == ENV.fetch("CHECK_HISTORY_SHA"), "Speech retry changed model history")
  puts "PASS speech-only explicit retry preserved dialogue/history/counts"
when "verify-storage"
  media = InterviewSessionMedia.where(interview_session: interview).where(kind: "speech", status: "ready").first
  assert_check(media.present?, "Missing saved artifact")
  object = Interviews::MediaStorage.new.read(media.sealed_key)
  assert_check(object[:checksum] == media.checksum, "Persisted S3 artifact changed across recreation")
  grant = checked(Interviews::ReadMediaService.call(interview: interview, message_id: media.message_id,
    storage: Interviews::MediaStorage.new))
  uri = URI(grant[:playback_url])
  assert_check(Net::HTTP.get_response(uri).code == "200", "Saved playback not readable")
  puts "PASS attached audio survived storage container recreation and plays through issued grant"
when "retention"
  media = InterviewSessionMedia.where(interview_session: interview).where(kind: "speech", status: "ready").first
  key = media.sealed_key
  interview.update!(completed_at: 2.hours.ago)
  assert_check(!Interviews::ReadMediaService.call(interview: interview, message_id: media.message_id).success?, "Expired speech still playable")
  checked(Interviews::CleanupService.call(limit: 100))
  assert_check(media.reload.deleted?, "Completed-session speech not collected")
  begin
    Interviews::MediaStorage.new.read(key)
    raise "Expired object still stored"
  rescue Aws::S3::Errors::NoSuchKey
    # S3 actually removed the object, independently of application eligibility.
  end
  usage_count = user.ai_tasks.joins(:ai_usage_attempts).count
  interview.update!(expires_at: 1.second.ago)
  checked(Interviews::CleanupService.call(limit: 100))
  assert_check(interview.reload.content_purged_at && interview.fixture_context.empty? && interview.questions.first.model_history.empty?, "Expired content/history remains")
  assert_check(user.ai_tasks.joins(:ai_usage_attempts).count == usage_count, "Cleanup lost accounting facts")
  puts "PASS real storage deletion, expired playback/work and dialogue scrub preserve accounting facts"
when "cleanup"
  user.interview_sessions.each do |session|
    InterviewSessionMedia.where(interview_session: session).each do |media|
      [ media.staging_key, media.sealed_key ].compact.each { |key| Interviews::MediaStorage.new.delete(key) }
    end
    InterviewSessionMedia.where(interview_session: session).delete_all
  end
  user.destroy!
  puts "PASS disposable fixtures removed"
else
  raise "Unknown check phase"
end

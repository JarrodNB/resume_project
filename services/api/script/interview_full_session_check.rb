# Verify full preparation and recovery with real Rails/Postgres/private S3 and mocked provider HTTP.
# The companion shell script owns process kills; this runner owns assertions and fixtures.
require "net/http"
require "digest"

raise "Development synthetic check only" unless Rails.env.development? && ENV["INTERVIEW_SYNTHETIC_PROVIDER_CHECK"] == "true"
run_id = ENV.fetch("CHECK_RUN_ID")
raise "Invalid check identity" unless run_id.match?(/\A[a-z0-9-]{1,60}\z/)
email = "full-session-#{run_id}@example.invalid"

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
  values = values.merge(execution_mode: "real") if action == "claim"
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
    question_id: interview.questions.find_by!(position: interview.current_question_position).id, expected_revision: interview.revision,
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
  checked(Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.find_by!(position: interview.current_question_position).id,
    recording_id: media.id, expected_revision: interview.revision, submission_key: key))
end


phase = ENV.fetch("CHECK_PHASE")
user = User.find_by(email: email)
if phase == "setup"
  raise "Run identity already exists" if user
  user = User.create!(email: email, password: SecureRandom.base64(30), confirmed_at: Time.current,
    summary: "I improve scheduling tools and coordinate team projects.")
  interview = checked(Interviews::StartPreparationService.call(user: user, career_focus: "Scheduling coordination"))
  puts "OPERATION_ID=#{interview.operations.preparation.first.id}"
  return
end
raise "Missing check user" unless user
interview = user.interview_sessions.reorder(:created_at, :id).first
main_count = Interviews::SetupConfiguration.for(interview).fetch("question_count")
response_cap = interview.answer_cap
case phase
when "ready"
  await_saved(interview.operations.preparation.first)
  assert_check(interview.reload.ready? && interview.questions.count == main_count, "Complete preparation missing")
  assert_check(interview.messages.empty? && interview.operations.speech.empty?, "Preparation began speech")
  assert_check(interview.career_focus == "Scheduling coordination", "Focus choice not saved")
  puts "PASS frozen owned library/focus prepared atomically; #{main_count} questions ready with no speech"
when "begin"
  2.times { checked(Interviews::BeginService.call(interview: interview)) }
  assert_check(interview.messages.opening.count == 1 && interview.operations.speech.count == 1, "Begin duplicated opening")
  puts "PASS explicit Begin is idempotent"
when "opening"
  await_saved(interview.operations.speech.first)
when "submit"
  operation = submit(interview, ENV.fetch("CHECK_CASE", "fault-turn"))
  puts "OPERATION_ID=#{operation.id}"
when "recovered"
  operation = interview.operations.turn.find_by!(submission_key: "fault-turn")
  await_saved(operation)
  await_saved(interview.operations.speech.order(:created_at).last)
  assert_check(interview.reload.messages.answer.count == 1, "Turn duplicated after restart")
  puts "PASS killed turn recovered with one accepted answer"
when "full"
  loop do
    interview.reload
    break if interview.completed?
    await_saved(interview.operations.speech.order(:created_at).last)
    question = interview.questions.find_by!(position: interview.current_question_position)
    key = "question-#{question.position}-answer-#{question.accepted_answer_count + 1}"
    operation = submit(interview, key)
    replay = checked(Interviews::SubmitTurnService.call(interview: interview, question_id: question.id,
      recording_id: operation.recording_id, expected_revision: operation.expected_revision, submission_key: key))
    assert_check(replay.id == operation.id, "Duplicate submission created another operation")
    await_saved(operation)
  end
  await_saved(interview.operations.speech.order(:created_at).last)
  assert_check(interview.questions.order(:position).pluck(:accepted_answer_count) == [ response_cap ] * main_count, "Full cap sequence missing")
  assert_check(interview.messages.answer.count == main_count * response_cap && interview.messages.opening.count == main_count &&
    interview.messages.follow_up.count == main_count * (response_cap - 1) && interview.messages.closing.count == 1, "Wrong full-session dialogue")
  if (killed = interview.operations.turn.find_by(submission_key: "after-accept"))
    assert_check(killed.execution_count == 1, "Restart reran accepted reasoning")
    lost = interview.operations.turn.find_by!(submission_key: "fault-turn")
    assert_check(lost.execution_count == 1, "Lost receipt reran reasoning")
    preparation = interview.operations.preparation.first
    assert_check(preparation.execution_count == 2 && preparation.ai_task.ai_usage_attempts.any?(&:incomplete),
      "Preparation restart lost the killed execution or unknown marker")
  end
  root = interview.operations.preparation.first.ai_task
  children = user.ai_tasks.where(hourly_admission_task_id: root.id)
  assert_check(children.count == 2 * main_count * response_cap + 1 && user.ai_tasks.where(hourly_admission_task_id: nil).count == 1, "Session admission was not shared")
  turn = interview.operations.turn.order(:created_at).last
  stale = internal_request(turn, "heartbeat", { attempt_id: SecureRandom.uuid, claim_generation: 0 })
  assert_check(stale.code == "409", "Stale callback accepted")
  puts "PASS #{main_count} x #{response_cap} answers; duplicate submissions; full dialogue; one hourly root; stale callback fenced"
when "retry-prepare", "retry-verify"
  speech = interview.operations.speech.order(:created_at).last
  snapshot = lambda do
    Digest::SHA256.hexdigest(JSON.generate([
      interview.messages.order(:position).pluck(:id, :kind, :content, :acknowledgement),
      interview.questions.order(:position).pluck(:accepted_answer_count),
      interview.operations.turn.order(:id).pluck(:id, :execution_count),
      InterviewProviderAttempt.joins(:execution_attempt).where(interview_execution_attempts: {
        operation_id: interview.operations.turn.select(:id) }).order(:id).pluck(:id)
    ]))
  end
  if phase == "retry-prepare"
    claim = JSON.parse(internal_request(speech, "claim").body).slice("attempt_id", "claim_generation")
    assert_check(internal_request(speech, "fail", claim.merge(code: "speech_failed", retryable: false)).code == "200", "Speech failure rejected")
    checked(Interviews::RetryOperationService.call(operation: speech.reload))
    puts "HISTORY_SHA=#{snapshot.call}"
  else
    await_saved(speech)
    assert_check(snapshot.call == ENV.fetch("CHECK_HISTORY_SHA") && speech.execution_count == 2, "Speech recovery changed dialogue/reasoning")
    puts "PASS speech-only retry preserves exact dialogue/history/counts/turn provider identities"
  end
when "abandon-setup"
  target = checked(Interviews::StartPreparationService.call(user: user))
  operation = target.operations.preparation.first
  claim = JSON.parse(internal_request(operation, "claim").body)
  checked(Interviews::AbandonService.call(interview: target))
  before = target.operations.count
  response = internal_request(operation, "accept_preparation", claim.slice("attempt_id", "claim_generation").merge(
    role: { title: "Stale", responsibilities: [ "Stale" ], requirements: [ "Stale" ] },
    questions: Interviews::SetupConfiguration.question_types(target).each_with_index.map { |type, index|
      { question_type: type, content: "Stale question #{index}" }
    }))
  assert_check(response.code == "409" && target.questions.empty? && target.operations.count == before, "Abandoned claim changed preparation")
  assert_check(!Interviews::BeginService.call(interview: target).success?, "Abandoned session began")
  assert_check(operation.reload.expired? && operation.ai_task.ai_usage_attempts.exists?, "Abandon lost accounting")
  puts "PASS abandon fences preparation callbacks and Begin; accounting retained"
when "storage"
  media = InterviewSessionMedia.where(interview_session: interview, kind: "speech", status: "ready").first!
  object = Interviews::MediaStorage.new.read(media.sealed_key)
  assert_check(object[:checksum] == media.checksum, "Storage recreation lost audio")
  grant = checked(Interviews::ReadMediaService.call(interview: interview, message_id: media.message_id))
  assert_check(Net::HTTP.get_response(URI(grant[:playback_url])).code == "200", "Owned audio playback failed")
  puts "PASS private speech survives S3 recreation and owner-issued playback"
else
  raise "Unknown check phase"
end

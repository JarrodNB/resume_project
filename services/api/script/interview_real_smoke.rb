# Proves the real backend flow against a running real runtime with mocked provider HTTP and private storage.
# Uses a disposable fictional account and generated WAV input; never calls paid providers.
require "net/http"
require "digest"

raise "Synthetic real check only" unless Rails.env.development? && ENV["INTERVIEW_SERVICE_SECRET"].present? && ENV["INTERVIEW_SYNTHETIC_PROVIDER_CHECK"] == "true"

def checked(result)
  raise result.errors.inspect unless result.success?
  result.value
end

def await_operation(operation)
  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 45
  loop do
    operation.reload
    return if operation.accepted?
    raise "Execution failed: #{operation.failure_code}" if operation.failed?
    raise "Runtime did not finish operation" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
    sleep 0.2
  end
end

user = User.create!(email: "interview-smoke-#{SecureRandom.hex(6)}@example.invalid",
  password: SecureRandom.base64(30), confirmed_at: Time.current)
begin
  interview = checked(Interviews::StartDemoService.call(user: user, execution_mode: "real"))
  await_operation(interview.operations.speech.first)
  storage = Interviews::MediaStorage.new
  samples = (0...800).map { |index| (Math.sin(index * Math::PI / 20) * 3000).to_i }.pack("s<*")
  bytes = "RIFF" + [ 36 + samples.bytesize ].pack("V") + "WAVEfmt " +
    [ 16, 1, 1, 8000, 16000, 2, 16 ].pack("VvvVVvv") + "data" + [ samples.bytesize ].pack("V") + samples
  2.times do |answer_index|
    interview.reload
    question = interview.questions.find_by!(position: interview.current_question_position)
    receipt = checked(Interviews::ReserveRecordingService.call(interview: interview,
      question_id: question.id, expected_revision: interview.revision, content_type: "audio/wav",
      byte_size: bytes.bytesize, checksum: Digest::MD5.base64digest(bytes), storage: storage))
    uri = URI(receipt[:upload_url])
    response = Net::HTTP.start(uri.host, uri.port, open_timeout: 3, read_timeout: 5) do |http|
      http.request(Net::HTTP::Put.new(uri, receipt[:headers]).tap { |request| request.body = bytes })
    end
    raise "Upload failed" unless response.code == "200"
    media = InterviewSessionMedia.find(receipt[:media_id])
    checked(Interviews::RegisterMediaService.call(media: media, storage: storage))
    operation = checked(Interviews::SubmitTurnService.call(interview: interview,
      question_id: question.id, recording_id: media.id, expected_revision: interview.revision,
      submission_key: SecureRandom.uuid))
    await_operation(operation)
    speech = interview.operations.speech.order(:created_at).last
    if answer_index.zero?
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 45
      until speech.reload.failed?
        raise "Expected synthetic speech failure" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
        sleep 0.2
      end
      history = question.reload.model_history.deep_dup
      dialogue = interview.messages.order(:position).pluck(:kind, :content)
      turn_attempts = operation.reload.execution_count
      provider_attempts = InterviewProviderAttempt.joins(:execution_attempt).where(interview_execution_attempts: { operation_id: operation.id }).count
      checked(Interviews::RetryOperationService.call(operation: speech))
      await_operation(speech)
      raise "Speech retry changed dialogue/history" unless question.reload.model_history == history && interview.messages.order(:position).pluck(:kind, :content) == dialogue
      raise "Speech retry reran reasoning" unless operation.reload.execution_count == turn_attempts
      raise "Speech retry repeated turn providers" unless InterviewProviderAttempt.joins(:execution_attempt).where(interview_execution_attempts: { operation_id: operation.id }).count == provider_attempts
      raise "Speech retry missing" unless speech.execution_count == 2
    else
      await_operation(speech)
    end
  end
  interview.reload
  raise "Missing completion" unless interview.completed? && interview.messages.answer.count == 2
  raise "Speech not attached" unless interview.operations.speech.all?(&:accepted?)
  interview.messages.where.not(kind: "answer").each do |message|
    receipt = checked(Interviews::ReadMediaService.call(interview: interview, message_id: message.id))
    response = Net::HTTP.get_response(URI(receipt[:playback_url]))
    raise "Private playback unavailable" unless response.code == "200" && response.body.start_with?("RIFF") && response.body.bytesize <= 10.megabytes
  end
  # Accounting follows acceptance and must not delay the saved dialogue transaction.
  accounting_deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 10
  while user.ai_tasks.any? { |task| task.ai_usage_attempts.any?(&:incomplete) }
    raise "Unknown mocked real costs" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= accounting_deadline
    sleep 0.1
  end
  raise "Missing real charges" unless user.ai_tasks.sum(:cost_microdollars).positive?
  raise "Wrong transcript" unless interview.messages.answer.all? { |answer| answer.content.include?("fifteen minutes") }
  raise "Missing follow-up" unless interview.messages.exists?(content: "How did you measure the shorter wait?")
  puts "PASS: two accepted answers, forced cap, exact saved speech, speech-only retry, private playback and reconciled synthetic usage"
ensure
  user.interview_sessions.each do |session|
    InterviewSessionMedia.where(interview_session: session).each do |media|
      [ media.staging_key, media.sealed_key ].each { |key| Interviews::MediaStorage.new.delete(key) }
    end
    InterviewSessionMedia.where(interview_session: session).delete_all
  end
  user.destroy!
end

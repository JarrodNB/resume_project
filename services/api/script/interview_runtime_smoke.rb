# Proves the offline backend flow against a running fake runtime and private storage.
# Uses a disposable fictional account and generated WAV input; never calls paid providers.
require "net/http"
require "digest"

raise "Local fake check only" unless Rails.env.development? && ENV["INTERVIEW_SERVICE_SECRET"].present?

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
  interview = checked(Interviews::CreateFixtureService.call(user: user))
  await_operation(interview.operations.speech.first)
  storage = Interviews::MediaStorage.new
  samples = (0...800).map { |index| (Math.sin(index * Math::PI / 20) * 3000).to_i }.pack("s<*")
  bytes = "RIFF" + [ 36 + samples.bytesize ].pack("V") + "WAVEfmt " +
    [ 16, 1, 1, 8000, 16000, 2, 16 ].pack("VvvVVvv") + "data" + [ samples.bytesize ].pack("V") + samples
  2.times do
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
    await_operation(interview.operations.speech.order(:created_at).last)
  end
  interview.reload
  raise "Missing completion" unless interview.completed? && interview.messages.answer.count == 2
  raise "Speech not attached" unless interview.operations.speech.all?(&:accepted?)
  # Accounting follows acceptance and must not delay the saved dialogue transaction.
  accounting_deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 10
  while user.ai_tasks.any? { |task| task.ai_usage_attempts.any?(&:incomplete) }
    raise "Unknown fake costs" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= accounting_deadline
    sleep 0.1
  end
  raise "Unexpected fake cost" unless user.ai_tasks.sum(:cost_microdollars).zero?
  puts "PASS: two accepted answers, forced cap, saved dialogue and three attached speech artifacts"
ensure
  user.interview_sessions.each do |session|
    InterviewSessionMedia.where(interview_session: session).each do |media|
      [ media.staging_key, media.sealed_key ].each { |key| Interviews::MediaStorage.new.delete(key) }
    end
    InterviewSessionMedia.where(interview_session: session).delete_all
  end
  user.destroy!
end

# Verify real provider failure callbacks through Rails and mocked HTTP, with no paid calls.
# Uses an isolated synthetic development DB; deliberately retains its unknown reservation.
raise "Synthetic verification only" unless Rails.env.development? && ENV["INTERVIEW_SYNTHETIC_PROVIDER_CHECK"] == "true"
user = User.create!(email: "spoken-fault-#{SecureRandom.hex(6)}@example.invalid", password: SecureRandom.base64(30), confirmed_at: Time.current,
  summary: "I coordinate scheduling improvements and build tools for team projects.")
result = Interviews::StartDemoService.call(user: user, execution_mode: "real")
raise "Creation rejected" unless result.success?
interview = result.value
preparation = interview.operations.preparation.first
deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 70
until preparation.reload.accepted?
  raise "Preparation did not complete" if preparation.failed? || Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
  sleep 0.1
end
raise "Begin rejected" unless Interviews::BeginService.call(interview: interview.reload).success?
operation = interview.operations.speech.first
deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 30
loop do
  operation.reload
  break if operation.failure_code.present?
  raise "Failure was not saved" if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
  sleep 0.1
end
raise "Unsupported callback" unless operation.failure_code == "dependency_unavailable"
observations = InterviewProviderAttempt.joins(:execution_attempt).where(
  interview_execution_attempts: { operation_id: operation.id }).select(:observation_id)
reservations = InterviewVerificationReservation.where(observation_id: observations)
raise "Missing unknown reservation" unless reservations.where(actual_microdollars: nil).count == 1
raise "Invented speech cost" if reservations.where.not(actual_microdollars: nil).exists?
raise "Accepted failed speech" if operation.accepted?
puts "PASS real Rails callback persists dependency_unavailable; unknown provider cost stays reserved, failed speech unaccepted"

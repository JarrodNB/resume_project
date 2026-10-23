# Creates owned sealed audio metadata for tests of submission and execution boundaries.
# These specs do not read storage; actual object validation has separate media tests.
module InterviewMediaHelpers
  def ready_interview_recording(interview, question: interview.questions.first)
    InterviewSessionMedia.create!(interview_session: interview, question: question, kind: "recording", status: "ready",
      staging_key: "staging/#{SecureRandom.uuid}", sealed_key: "sealed/#{SecureRandom.uuid}", content_type: "audio/webm",
      byte_size: 100, checksum: "md5", expires_at: 1.hour.from_now)
  end
end

RSpec.configure { |config| config.include InterviewMediaHelpers }

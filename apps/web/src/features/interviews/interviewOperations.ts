/** Public owned interview operations. Only accepted dialogue and safe progress enter the client cache. */
import { graphql } from '@/graphql/generated'

export const INTERVIEW_FIELDS = graphql(`
  fragment InterviewSnapshot on InterviewSession {
    id status interviewType executionMode speechPlaybackMode preparedRole revision answerCap currentQuestionPosition expiresAt
    feedback { id status content attemptCount aiTaskId deadline }
    setup { questionCount questionFormat difficulty interviewer focusAreas }
    jobContext { id title company description requirements responsibilities niceToHaves }
    questions { id content questionType position acceptedAnswerCount skipped }
    messages { id questionId kind position content avoided acknowledgement spokenContent careerReferences { id status canRetry attemptCount aiTaskId deadline references { sourceType sourceId title body } } clarification { id status explanation attemptCount aiTaskId deadline } }
    operations { id questionId messageId kind status failureCode checkpoint submissionKey canRetry reviewTranscript expectedRevision }
  }
`)
export const INTERVIEW_QUERY = graphql(`
  query InterviewSession($id: ID!) { interviewSession(id: $id) { ...InterviewSnapshot } }
`)
export const INTERVIEW_UPDATED = graphql(`
  subscription InterviewSessionUpdated($id: ID!) { interviewSessionUpdated(id: $id) { ...InterviewSnapshot } }
`)
export const START_INTERVIEW = graphql(`
  mutation StartInterview($careerFocus: String, $setup: InterviewSetupInput, $jobId: ID) { startInterview(input: {careerFocus: $careerFocus, setup: $setup, jobId: $jobId}) { interview { ...InterviewSnapshot } errors } }
`)
export const AUTHORIZE_RECORDING = graphql(`
  mutation AuthorizeInterviewRecording($input: AuthorizeInterviewRecordingInput!) {
    authorizeInterviewRecording(input: $input) { upload { mediaId uploadUrl headers expiresIn } errors }
  }
`)
export const REGISTER_RECORDING = graphql(`
  mutation RegisterInterviewRecording($input: RegisterInterviewRecordingInput!) {
    registerInterviewRecording(input: $input) { interview { ...InterviewSnapshot } errors }
  }
`)
export const SUBMIT_TURN = graphql(`
  mutation SubmitInterviewTurn($input: SubmitInterviewTurnInput!) {
    submitInterviewTurn(input: $input) { interview { ...InterviewSnapshot } errors }
  }
`)
export const RETRY_OPERATION = graphql(`
  mutation RetryInterviewOperation($input: RetryInterviewOperationInput!) {
    retryInterviewOperation(input: $input) { interview { ...InterviewSnapshot } errors }
  }
`)
export const INTERVIEW_PLAYBACK = graphql(`
  mutation InterviewPlayback($input: InterviewPlaybackInput!) {
    interviewPlayback(input: $input) { playback { playbackUrl expiresIn contentType } errors }
  }
`)

export const BEGIN_INTERVIEW = graphql(`
  mutation BeginInterview($interviewId: ID!) {
    beginInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors }
  }
`)

export const ABANDON_INTERVIEW = graphql(`
  mutation AbandonInterview($interviewId: ID!) {
    abandonInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors }
  }
`)

export const RECENT_INTERVIEWS = graphql(`
  query RecentInterviewSessions {
    recentInterviewSessions { id status createdAt currentQuestionPosition questions { id } jobContext { id title company } }
  }
`)

export const START_RECORDED_TRANSCRIPTION = graphql(`
  mutation StartRecordedTranscription($input: StartRecordedTranscriptionInput!) {
    startRecordedTranscription(input: $input) { operationId interview { ...InterviewSnapshot } errors }
  }
`)
export const CANCEL_RECORDED_TRANSCRIPTION = graphql(`
  mutation CancelRecordedTranscription($input: CancelRecordedTranscriptionInput!) {
    cancelRecordedTranscription(input: $input) { interview { ...InterviewSnapshot } errors }
  }
`)
export const REQUEST_INTERVIEW_CLARIFICATION = graphql(`
  mutation RequestInterviewClarification($input: RequestInterviewClarificationInput!) {
    requestInterviewClarification(input: $input) {
      clarification { id status explanation attemptCount aiTaskId deadline }
      errors
    }
  }
`)
export const SKIP_QUESTION = graphql(`
  mutation SkipInterviewQuestion($input: SkipInterviewQuestionInput!) {
    skipInterviewQuestion(input: $input) { interview { ...InterviewSnapshot } errors }
  }
`)

export const AVOID_INTERVIEW_PROMPT = graphql(`
  mutation AvoidInterviewPrompt($interviewId: ID!, $messageId: ID!) {
    avoidInterviewPrompt(input: {interviewId: $interviewId, messageId: $messageId}) { saved errors }
  }
`)

export const REQUEST_INTERVIEW_REFERENCES = graphql(`
  mutation RequestInterviewReferences($input: RequestInterviewReferencesInput!) {
    requestInterviewReferences(input: $input) {
      careerReferences { id status canRetry attemptCount aiTaskId deadline references { sourceType sourceId title body } }
      errors
    }
  }
`)

export const REQUEST_INTERVIEW_SESSION_FEEDBACK = graphql(`
  mutation RequestInterviewSessionFeedback($input: RequestInterviewSessionFeedbackInput!) {
    requestInterviewSessionFeedback(input: $input) {
      feedback { id status content attemptCount aiTaskId deadline }
      errors
    }
  }
`)

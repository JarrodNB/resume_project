/** Public owned interview operations. Only accepted dialogue and safe progress enter the client cache. */
import { graphql } from '@/graphql/generated'

export const INTERVIEW_FIELDS = graphql(`
  fragment InterviewSnapshot on InterviewSession {
    id status interviewType conversationMode executionMode speechPlaybackMode preparedRole revision answerCap currentQuestionPosition expiresAt
    feedback { id status content attemptCount aiTaskId deadline }
    setup { questionCount questionFormat difficulty interviewer focusAreas }
    jobContext { id title company description requirements responsibilities niceToHaves }
    questions { id content questionType position acceptedAnswerCount skipped liveFeedback }
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
  mutation StartInterview($careerFocus: String, $setup: InterviewSetupInput, $jobId: ID, $conversationMode: ConversationModeEnum) { startInterview(input: {careerFocus: $careerFocus, setup: $setup, jobId: $jobId, conversationMode: $conversationMode}) { interview { ...InterviewSnapshot } errors errorCode } }
`)
/** Starts with the same setup, saved job and career focus as an earlier owned interview; Rails copies them. */
export const START_INTERVIEW_FROM = graphql(`
  mutation StartInterviewFrom($fromInterviewId: ID!, $conversationMode: ConversationModeEnum) { startInterview(input: {fromInterviewId: $fromInterviewId, conversationMode: $conversationMode}) { interview { ...InterviewSnapshot } errors errorCode } }
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
    retryInterviewOperation(input: $input) { interview { ...InterviewSnapshot } errors errorCode }
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

/** Live interviews only: a LiveKit address and short-lived join token; the first join starts the interview. */
export const JOIN_LIVE_INTERVIEW = graphql(`
  mutation JoinLiveInterview($interviewId: ID!) {
    joinLiveInterview(input: {interviewId: $interviewId}) { url token roomName expiresAt interview { ...InterviewSnapshot } errors errorCode }
  }
`)

/** Live interview seconds the viewer has left (trial total or today's paid minutes); a new live interview needs 300. */
export const LIVE_INTERVIEW_ALLOWANCE = graphql(`
  query LiveInterviewAllowance { me { id liveInterviewSecondsLeft } }
`)

export const END_LIVE_INTERVIEW = graphql(`
  mutation EndLiveInterview($interviewId: ID!) {
    endLiveInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors errorCode }
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
    startRecordedTranscription(input: $input) { operationId interview { ...InterviewSnapshot } errors errorCode }
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
      errorCode
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
    avoidInterviewPrompt(input: {interviewId: $interviewId, messageId: $messageId}) { saved errors errorCode }
  }
`)

export const REQUEST_INTERVIEW_REFERENCES = graphql(`
  mutation RequestInterviewReferences($input: RequestInterviewReferencesInput!) {
    requestInterviewReferences(input: $input) {
      careerReferences { id status canRetry attemptCount aiTaskId deadline references { sourceType sourceId title body } }
      errors
      errorCode
    }
  }
`)

export const REQUEST_INTERVIEW_SESSION_FEEDBACK = graphql(`
  mutation RequestInterviewSessionFeedback($input: RequestInterviewSessionFeedbackInput!) {
    requestInterviewSessionFeedback(input: $input) {
      feedback { id status content attemptCount aiTaskId deadline }
      errors
      errorCode
    }
  }
`)

export const AUTHORIZE_INTERVIEW_OUTPUT = graphql(`
  mutation AuthorizeInterviewOutput($input: AuthorizeAiExecutionStreamInput!) {
    authorizeAiExecutionStream(input: $input) { token expiresAt errors }
  }
`)

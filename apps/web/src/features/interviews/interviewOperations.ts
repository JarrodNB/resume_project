/** Public owned interview operations. Only accepted dialogue and safe progress enter the client cache. */
import { graphql } from '@/graphql/generated'

export const INTERVIEW_FIELDS = graphql(`
  fragment InterviewSnapshot on InterviewSession {
    id status interviewType executionMode speechPlaybackMode preparedRole revision answerCap currentQuestionPosition expiresAt
    questions { id content questionType position acceptedAnswerCount }
    messages { id questionId kind position content acknowledgement spokenContent }
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
  mutation StartInterviewDemo($careerFocus: String) { startInterviewDemo(input: {careerFocus: $careerFocus}) { interview { ...InterviewSnapshot } errors } }
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
    recentInterviewSessions { id status createdAt currentQuestionPosition questions { id } }
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

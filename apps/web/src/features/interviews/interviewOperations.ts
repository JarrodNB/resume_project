/** Public owned interview operations. Only accepted dialogue and safe progress enter the client cache. */
import { graphql } from '@/graphql/generated'

export const INTERVIEW_FIELDS = graphql(`
  fragment InterviewSnapshot on InterviewSession {
    id status interviewType executionMode revision answerCap currentQuestionPosition expiresAt
    questions { id content position acceptedAnswerCount }
    messages { id questionId kind position content }
    operations { id questionId messageId kind status failureCode checkpoint submissionKey canRetry }
  }
`)
export const INTERVIEW_QUERY = graphql(`
  query InterviewSession($id: ID!) { interviewSession(id: $id) { ...InterviewSnapshot } }
`)
export const INTERVIEW_UPDATED = graphql(`
  subscription InterviewSessionUpdated($id: ID!) { interviewSessionUpdated(id: $id) { ...InterviewSnapshot } }
`)
export const START_INTERVIEW = graphql(`
  mutation StartInterviewDemo { startInterviewDemo(input: {}) { interview { ...InterviewSnapshot } errors } }
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

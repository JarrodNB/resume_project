/**
 * Description: Persistent interview sets and answer, feedback, and replacement operations.
 * Index: INTERVIEW_SETS_QUERY, INTERVIEW_SET_QUERY, GENERATE_INTERVIEW_SET, DELETE_INTERVIEW_SET, SAVE_INTERVIEW_ANSWER, REQUEST_INTERVIEW_FEEDBACK, REGENERATE_INTERVIEW_QUESTION
 */
import { graphql } from '@/graphql/generated'

export const INTERVIEW_SETS_QUERY = graphql(`
  query InterviewSets {
    interviewQuestionSets {
      id number createdAt
      latestTask { id status errorMessage }
    }
  }
`)
export const INTERVIEW_SET_QUERY = graphql(`
  query InterviewSet($id: ID!) {
    interviewQuestionSet(id: $id) {
      id number createdAt
      latestTask { id status errorMessage result }
      questions { id position questionText answerText answerRevision questionRevision feedback feedbackQuestionRevision feedbackAnswerRevision feedbackOutdated latestTask { id status taskType errorMessage } }
    }
  }
`)
export const GENERATE_INTERVIEW_SET = graphql(`
  mutation GenerateInterviewSet {
    generateInterviewQuestionSet(input: {}) {
      errors
      aiTask { id input }
    }
  }
`)
export const DELETE_INTERVIEW_SET = graphql(`
  mutation DeleteInterviewSet($id: ID!) {
    deleteInterviewQuestionSet(input: { id: $id }) { errors }
  }
`)

export const SAVE_INTERVIEW_ANSWER = graphql(`
  mutation SaveInterviewAnswer($questionSetId: ID!, $questionId: ID!, $answerText: String!) {
    saveInterviewAnswer(input: { questionSetId: $questionSetId, questionId: $questionId, answerText: $answerText }) {
      errors question { id answerText answerRevision feedbackOutdated }
    }
  }
`)
export const REQUEST_INTERVIEW_FEEDBACK = graphql(`
  mutation RequestInterviewFeedback($questionSetId: ID!, $questionId: ID!, $answerText: String!) {
    requestInterviewAnswerFeedback(input: { questionSetId: $questionSetId, questionId: $questionId, answerText: $answerText }) {
      errors aiTask { id status taskType errorMessage }
    }
  }
`)
export const REGENERATE_INTERVIEW_QUESTION = graphql(`
  mutation RegenerateInterviewQuestion($questionSetId: ID!, $questionId: ID!, $confirmed: Boolean!) {
    regenerateInterviewQuestion(input: { questionSetId: $questionSetId, questionId: $questionId, confirmed: $confirmed }) {
      errors aiTask { id status taskType errorMessage }
    }
  }
`)

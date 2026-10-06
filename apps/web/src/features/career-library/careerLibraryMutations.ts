/**
 * Description: GraphQL mutations that delete or merge career library entries (typed by GraphQL
 * Code Generator).
 * Index:
 *   - DELETE_EXPERIENCE_MUTATION, DELETE_PROJECT_MUTATION, DELETE_EDUCATION_MUTATION,
 *     DELETE_SKILL_MUTATION, DELETE_LIBRARY_FACT_MUTATION
 *   - CLEAR_CAREER_LIBRARY_MUTATION
 *   - MERGE_EXPERIENCES_MUTATION, MERGE_PROJECTS_MUTATION, MERGE_EDUCATIONS_MUTATION
 */
import { graphql } from '@/graphql/generated'

export const DELETE_EXPERIENCE_MUTATION = graphql(`
  mutation DeleteExperience($id: ID!) {
    deleteExperience(input: { id: $id }) {
      errors
    }
  }
`)

export const DELETE_PROJECT_MUTATION = graphql(`
  mutation DeleteProject($id: ID!) {
    deleteProject(input: { id: $id }) {
      errors
    }
  }
`)

export const DELETE_EDUCATION_MUTATION = graphql(`
  mutation DeleteEducation($id: ID!) {
    deleteEducation(input: { id: $id }) {
      errors
    }
  }
`)

export const DELETE_SKILL_MUTATION = graphql(`
  mutation DeleteSkill($id: ID!) {
    deleteSkill(input: { id: $id }) {
      errors
    }
  }
`)

export const DELETE_LIBRARY_FACT_MUTATION = graphql(`
  mutation DeleteLibraryFact($id: ID!) {
    deleteLibraryFact(input: { id: $id }) {
      errors
    }
  }
`)

export const CLEAR_CAREER_LIBRARY_MUTATION = graphql(`
  mutation ClearCareerLibrary {
    clearCareerLibrary(input: {}) {
      errors
    }
  }
`)

export const MERGE_EXPERIENCES_MUTATION = graphql(`
  mutation MergeExperiences($targetId: ID!, $sourceId: ID!) {
    mergeExperiences(input: { targetId: $targetId, sourceId: $sourceId }) {
      errors
    }
  }
`)

export const MERGE_PROJECTS_MUTATION = graphql(`
  mutation MergeProjects($targetId: ID!, $sourceId: ID!) {
    mergeProjects(input: { targetId: $targetId, sourceId: $sourceId }) {
      errors
    }
  }
`)

export const MERGE_EDUCATIONS_MUTATION = graphql(`
  mutation MergeEducations($targetId: ID!, $sourceId: ID!) {
    mergeEducations(input: { targetId: $targetId, sourceId: $sourceId }) {
      errors
    }
  }
`)

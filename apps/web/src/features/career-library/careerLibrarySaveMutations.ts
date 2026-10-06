/**
 * Description: GraphQL mutations that create or update career library entries (typed by GraphQL
 * Code Generator).
 * Index:
 *   - UPDATE_PROFILE_MUTATION
 *   - CREATE_EXPERIENCE_MUTATION, UPDATE_EXPERIENCE_MUTATION
 *   - CREATE_PROJECT_MUTATION, UPDATE_PROJECT_MUTATION
 *   - CREATE_EDUCATION_MUTATION, UPDATE_EDUCATION_MUTATION
 *   - CREATE_SKILL_MUTATION, UPDATE_SKILL_MUTATION
 *   - CREATE_LIBRARY_FACT_MUTATION, UPDATE_LIBRARY_FACT_MUTATION
 */
import { graphql } from '@/graphql/generated'

export const UPDATE_PROFILE_MUTATION = graphql(`
  mutation UpdateProfile($attributes: ProfileAttributesInput!) {
    updateProfile(input: { attributes: $attributes }) {
      errors
    }
  }
`)

export const CREATE_EXPERIENCE_MUTATION = graphql(`
  mutation CreateExperience($attributes: ExperienceAttributesInput!, $highlights: [String!]) {
    createExperience(input: { attributes: $attributes, highlights: $highlights }) {
      errors
    }
  }
`)

export const UPDATE_EXPERIENCE_MUTATION = graphql(`
  mutation UpdateExperience($id: ID!, $attributes: ExperienceAttributesInput!, $highlights: [String!]) {
    updateExperience(input: { id: $id, attributes: $attributes, highlights: $highlights }) {
      errors
    }
  }
`)

export const CREATE_PROJECT_MUTATION = graphql(`
  mutation CreateProject($attributes: ProjectAttributesInput!) {
    createProject(input: { attributes: $attributes }) {
      errors
    }
  }
`)

export const UPDATE_PROJECT_MUTATION = graphql(`
  mutation UpdateProject($id: ID!, $attributes: ProjectAttributesInput!) {
    updateProject(input: { id: $id, attributes: $attributes }) {
      errors
    }
  }
`)

export const CREATE_EDUCATION_MUTATION = graphql(`
  mutation CreateEducation($attributes: EducationAttributesInput!) {
    createEducation(input: { attributes: $attributes }) {
      errors
    }
  }
`)

export const UPDATE_EDUCATION_MUTATION = graphql(`
  mutation UpdateEducation($id: ID!, $attributes: EducationAttributesInput!) {
    updateEducation(input: { id: $id, attributes: $attributes }) {
      errors
    }
  }
`)

export const CREATE_SKILL_MUTATION = graphql(`
  mutation CreateSkill($attributes: SkillAttributesInput!) {
    createSkill(input: { attributes: $attributes }) {
      errors
    }
  }
`)

export const UPDATE_SKILL_MUTATION = graphql(`
  mutation UpdateSkill($id: ID!, $attributes: SkillAttributesInput!) {
    updateSkill(input: { id: $id, attributes: $attributes }) {
      errors
    }
  }
`)

export const CREATE_LIBRARY_FACT_MUTATION = graphql(`
  mutation CreateLibraryFact($attributes: LibraryFactAttributesInput!) {
    createLibraryFact(input: { attributes: $attributes }) {
      errors
    }
  }
`)

export const UPDATE_LIBRARY_FACT_MUTATION = graphql(`
  mutation UpdateLibraryFact($id: ID!, $attributes: LibraryFactAttributesInput!) {
    updateLibraryFact(input: { id: $id, attributes: $attributes }) {
      errors
    }
  }
`)

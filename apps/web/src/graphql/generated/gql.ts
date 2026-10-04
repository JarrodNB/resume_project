/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      errorMessage\n      acceptedAt\n      createdAt\n      job {\n        id\n      }\n    }\n  }\n": typeof types.AiTaskUpdatedDocument,
    "\n  mutation DeleteExperience($id: ID!) {\n    deleteExperience(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteExperienceDocument,
    "\n  mutation DeleteProject($id: ID!) {\n    deleteProject(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteProjectDocument,
    "\n  mutation DeleteEducation($id: ID!) {\n    deleteEducation(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteEducationDocument,
    "\n  mutation DeleteSkill($id: ID!) {\n    deleteSkill(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteSkillDocument,
    "\n  mutation MergeExperiences($targetId: ID!, $sourceId: ID!) {\n    mergeExperiences(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": typeof types.MergeExperiencesDocument,
    "\n  mutation MergeProjects($targetId: ID!, $sourceId: ID!) {\n    mergeProjects(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": typeof types.MergeProjectsDocument,
    "\n  mutation MergeEducations($targetId: ID!, $sourceId: ID!) {\n    mergeEducations(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": typeof types.MergeEducationsDocument,
    "\n  query CareerLibrary {\n    me {\n      id\n      name\n      contactEmail\n      phone\n      location\n      links\n      summary\n    }\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n        position\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    skills {\n      id\n      name\n      category\n      position\n    }\n  }\n": typeof types.CareerLibraryDocument,
    "\n  mutation ReorderSkills($orderedIds: [ID!]!) {\n    reorderSkills(input: { orderedIds: $orderedIds }) {\n      errors\n    }\n  }\n": typeof types.ReorderSkillsDocument,
    "\n  mutation MoveExperienceHighlight($highlightId: ID!, $experienceId: ID!, $position: Int!) {\n    moveExperienceHighlight(input: { highlightId: $highlightId, experienceId: $experienceId, position: $position }) {\n      experience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      sourceExperience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      errors\n    }\n  }\n": typeof types.MoveExperienceHighlightDocument,
    "\n  mutation AnalyzeJobGaps($jobId: ID!) {\n    analyzeJobGaps(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": typeof types.AnalyzeJobGapsDocument,
    "\n  query Jobs {\n    jobs {\n      id\n      title\n      company\n      location\n      stage\n      createdAt\n    }\n  }\n": typeof types.JobsDocument,
    "\n  query Job($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      location\n      stage\n      url\n      description\n      requirements\n      niceToHaves\n      latestGapAnalysis {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n    }\n  }\n": typeof types.JobDocument,
    "\n  mutation ScrapeJob($url: String!) {\n    scrapeJob(input: { url: $url }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": typeof types.ScrapeJobDocument,
    "\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": typeof types.ParseResumeDocument,
    "\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      aiTask {\n        id\n        acceptedAt\n        result\n      }\n      errors\n    }\n  }\n": typeof types.ImportParsedResumeDocument,
};
const documents: Documents = {
    "\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      errorMessage\n      acceptedAt\n      createdAt\n      job {\n        id\n      }\n    }\n  }\n": types.AiTaskUpdatedDocument,
    "\n  mutation DeleteExperience($id: ID!) {\n    deleteExperience(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteExperienceDocument,
    "\n  mutation DeleteProject($id: ID!) {\n    deleteProject(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteProjectDocument,
    "\n  mutation DeleteEducation($id: ID!) {\n    deleteEducation(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteEducationDocument,
    "\n  mutation DeleteSkill($id: ID!) {\n    deleteSkill(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteSkillDocument,
    "\n  mutation MergeExperiences($targetId: ID!, $sourceId: ID!) {\n    mergeExperiences(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": types.MergeExperiencesDocument,
    "\n  mutation MergeProjects($targetId: ID!, $sourceId: ID!) {\n    mergeProjects(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": types.MergeProjectsDocument,
    "\n  mutation MergeEducations($targetId: ID!, $sourceId: ID!) {\n    mergeEducations(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": types.MergeEducationsDocument,
    "\n  query CareerLibrary {\n    me {\n      id\n      name\n      contactEmail\n      phone\n      location\n      links\n      summary\n    }\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n        position\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    skills {\n      id\n      name\n      category\n      position\n    }\n  }\n": types.CareerLibraryDocument,
    "\n  mutation ReorderSkills($orderedIds: [ID!]!) {\n    reorderSkills(input: { orderedIds: $orderedIds }) {\n      errors\n    }\n  }\n": types.ReorderSkillsDocument,
    "\n  mutation MoveExperienceHighlight($highlightId: ID!, $experienceId: ID!, $position: Int!) {\n    moveExperienceHighlight(input: { highlightId: $highlightId, experienceId: $experienceId, position: $position }) {\n      experience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      sourceExperience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      errors\n    }\n  }\n": types.MoveExperienceHighlightDocument,
    "\n  mutation AnalyzeJobGaps($jobId: ID!) {\n    analyzeJobGaps(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": types.AnalyzeJobGapsDocument,
    "\n  query Jobs {\n    jobs {\n      id\n      title\n      company\n      location\n      stage\n      createdAt\n    }\n  }\n": types.JobsDocument,
    "\n  query Job($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      location\n      stage\n      url\n      description\n      requirements\n      niceToHaves\n      latestGapAnalysis {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n    }\n  }\n": types.JobDocument,
    "\n  mutation ScrapeJob($url: String!) {\n    scrapeJob(input: { url: $url }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": types.ScrapeJobDocument,
    "\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": types.ParseResumeDocument,
    "\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      aiTask {\n        id\n        acceptedAt\n        result\n      }\n      errors\n    }\n  }\n": types.ImportParsedResumeDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      errorMessage\n      acceptedAt\n      createdAt\n      job {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      errorMessage\n      acceptedAt\n      createdAt\n      job {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteExperience($id: ID!) {\n    deleteExperience(input: { id: $id }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteExperience($id: ID!) {\n    deleteExperience(input: { id: $id }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteProject($id: ID!) {\n    deleteProject(input: { id: $id }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteProject($id: ID!) {\n    deleteProject(input: { id: $id }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteEducation($id: ID!) {\n    deleteEducation(input: { id: $id }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteEducation($id: ID!) {\n    deleteEducation(input: { id: $id }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteSkill($id: ID!) {\n    deleteSkill(input: { id: $id }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteSkill($id: ID!) {\n    deleteSkill(input: { id: $id }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MergeExperiences($targetId: ID!, $sourceId: ID!) {\n    mergeExperiences(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation MergeExperiences($targetId: ID!, $sourceId: ID!) {\n    mergeExperiences(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MergeProjects($targetId: ID!, $sourceId: ID!) {\n    mergeProjects(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation MergeProjects($targetId: ID!, $sourceId: ID!) {\n    mergeProjects(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MergeEducations($targetId: ID!, $sourceId: ID!) {\n    mergeEducations(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation MergeEducations($targetId: ID!, $sourceId: ID!) {\n    mergeEducations(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CareerLibrary {\n    me {\n      id\n      name\n      contactEmail\n      phone\n      location\n      links\n      summary\n    }\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n        position\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    skills {\n      id\n      name\n      category\n      position\n    }\n  }\n"): (typeof documents)["\n  query CareerLibrary {\n    me {\n      id\n      name\n      contactEmail\n      phone\n      location\n      links\n      summary\n    }\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n        position\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    skills {\n      id\n      name\n      category\n      position\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ReorderSkills($orderedIds: [ID!]!) {\n    reorderSkills(input: { orderedIds: $orderedIds }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ReorderSkills($orderedIds: [ID!]!) {\n    reorderSkills(input: { orderedIds: $orderedIds }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MoveExperienceHighlight($highlightId: ID!, $experienceId: ID!, $position: Int!) {\n    moveExperienceHighlight(input: { highlightId: $highlightId, experienceId: $experienceId, position: $position }) {\n      experience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      sourceExperience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation MoveExperienceHighlight($highlightId: ID!, $experienceId: ID!, $position: Int!) {\n    moveExperienceHighlight(input: { highlightId: $highlightId, experienceId: $experienceId, position: $position }) {\n      experience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      sourceExperience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AnalyzeJobGaps($jobId: ID!) {\n    analyzeJobGaps(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation AnalyzeJobGaps($jobId: ID!) {\n    analyzeJobGaps(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Jobs {\n    jobs {\n      id\n      title\n      company\n      location\n      stage\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query Jobs {\n    jobs {\n      id\n      title\n      company\n      location\n      stage\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Job($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      location\n      stage\n      url\n      description\n      requirements\n      niceToHaves\n      latestGapAnalysis {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query Job($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      location\n      stage\n      url\n      description\n      requirements\n      niceToHaves\n      latestGapAnalysis {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ScrapeJob($url: String!) {\n    scrapeJob(input: { url: $url }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ScrapeJob($url: String!) {\n    scrapeJob(input: { url: $url }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      aiTask {\n        id\n        acceptedAt\n        result\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      aiTask {\n        id\n        acceptedAt\n        result\n      }\n      errors\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;
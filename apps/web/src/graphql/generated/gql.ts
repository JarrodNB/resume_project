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
    "\n  query CareerLibrary {\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    skills {\n      id\n      name\n      category\n    }\n    resumes {\n      id\n      title\n      kind\n      updatedAt\n      sections {\n        id\n      }\n    }\n  }\n": typeof types.CareerLibraryDocument,
    "\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": typeof types.ParseResumeDocument,
    "\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      errorMessage\n      acceptedAt\n      createdAt\n    }\n  }\n": typeof types.AiTaskUpdatedDocument,
    "\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      resume {\n        id\n        title\n      }\n      errors\n    }\n  }\n": typeof types.ImportParsedResumeDocument,
};
const documents: Documents = {
    "\n  query CareerLibrary {\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    skills {\n      id\n      name\n      category\n    }\n    resumes {\n      id\n      title\n      kind\n      updatedAt\n      sections {\n        id\n      }\n    }\n  }\n": types.CareerLibraryDocument,
    "\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": types.ParseResumeDocument,
    "\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      errorMessage\n      acceptedAt\n      createdAt\n    }\n  }\n": types.AiTaskUpdatedDocument,
    "\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      resume {\n        id\n        title\n      }\n      errors\n    }\n  }\n": types.ImportParsedResumeDocument,
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
export function graphql(source: "\n  query CareerLibrary {\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    skills {\n      id\n      name\n      category\n    }\n    resumes {\n      id\n      title\n      kind\n      updatedAt\n      sections {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  query CareerLibrary {\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    skills {\n      id\n      name\n      category\n    }\n    resumes {\n      id\n      title\n      kind\n      updatedAt\n      sections {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      errorMessage\n      acceptedAt\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      errorMessage\n      acceptedAt\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      resume {\n        id\n        title\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      resume {\n        id\n        title\n      }\n      errors\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;
/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type AiTaskStatusEnum =
  | 'COMPLETED'
  | 'FAILED'
  | 'NEEDS_USER_INPUT'
  | 'QUEUED';

export type AiTaskTypeEnum =
  | 'ANALYZE_GAPS'
  | 'PARSE_RESUME'
  | 'SCRAPE_JOB'
  | 'TAILOR_RESUME';

export type ResumeKindEnum =
  | 'BASE'
  | 'TAILORED';

export type CareerLibraryQueryVariables = Exact<{ [key: string]: never; }>;


export type CareerLibraryQuery = { experiences: Array<{ id: string, company: string, title: string, location: string | null, startDate: string | null, endDate: string | null, description: string | null, highlights: Array<{ id: string, content: string }> }>, projects: Array<{ id: string, name: string, role: string | null, url: string | null, startDate: string | null, endDate: string | null, description: string | null }>, educations: Array<{ id: string, institution: string, degree: string | null, fieldOfStudy: string | null, startDate: string | null, endDate: string | null, description: string | null }>, skills: Array<{ id: string, name: string, category: string | null }>, resumes: Array<{ id: string, title: string, kind: ResumeKindEnum, updatedAt: string, sections: Array<{ id: string }> }> };

export type ParseResumeMutationVariables = Exact<{
  file: File;
}>;


export type ParseResumeMutation = { parseResume: { errors: Array<string>, aiTask: { id: string, status: AiTaskStatusEnum } | null } | null };

export type AiTaskUpdatedSubscriptionVariables = Exact<{
  id: string | number;
}>;


export type AiTaskUpdatedSubscription = { aiTaskUpdated: { id: string, taskType: AiTaskTypeEnum, status: AiTaskStatusEnum, result: unknown, errorMessage: string | null, acceptedAt: string | null, createdAt: string } };

export type ImportParsedResumeMutationVariables = Exact<{
  aiTaskId: string | number;
  parsedResume: unknown;
}>;


export type ImportParsedResumeMutation = { importParsedResume: { errors: Array<string>, resume: { id: string, title: string } | null } | null };


export const CareerLibraryDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"CareerLibrary"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"experiences"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"company"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"location"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"description"}},{"kind":"Field","name":{"kind":"Name","value":"highlights"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"content"}}]}}]}},{"kind":"Field","name":{"kind":"Name","value":"projects"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"role"}},{"kind":"Field","name":{"kind":"Name","value":"url"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"description"}}]}},{"kind":"Field","name":{"kind":"Name","value":"educations"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"institution"}},{"kind":"Field","name":{"kind":"Name","value":"degree"}},{"kind":"Field","name":{"kind":"Name","value":"fieldOfStudy"}},{"kind":"Field","name":{"kind":"Name","value":"startDate"}},{"kind":"Field","name":{"kind":"Name","value":"endDate"}},{"kind":"Field","name":{"kind":"Name","value":"description"}}]}},{"kind":"Field","name":{"kind":"Name","value":"skills"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"category"}}]}},{"kind":"Field","name":{"kind":"Name","value":"resumes"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}},{"kind":"Field","name":{"kind":"Name","value":"kind"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}},{"kind":"Field","name":{"kind":"Name","value":"sections"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]}}]} as unknown as DocumentNode<CareerLibraryQuery, CareerLibraryQueryVariables>;
export const ParseResumeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ParseResume"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"file"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Upload"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"parseResume"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"file"},"value":{"kind":"Variable","name":{"kind":"Name","value":"file"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aiTask"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"status"}}]}},{"kind":"Field","name":{"kind":"Name","value":"errors"}}]}}]}}]} as unknown as DocumentNode<ParseResumeMutation, ParseResumeMutationVariables>;
export const AiTaskUpdatedDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"subscription","name":{"kind":"Name","value":"AiTaskUpdated"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"aiTaskUpdated"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"taskType"}},{"kind":"Field","name":{"kind":"Name","value":"status"}},{"kind":"Field","name":{"kind":"Name","value":"result"}},{"kind":"Field","name":{"kind":"Name","value":"errorMessage"}},{"kind":"Field","name":{"kind":"Name","value":"acceptedAt"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<AiTaskUpdatedSubscription, AiTaskUpdatedSubscriptionVariables>;
export const ImportParsedResumeDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"ImportParsedResume"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"aiTaskId"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"ID"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"parsedResume"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"JSON"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"importParsedResume"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"input"},"value":{"kind":"ObjectValue","fields":[{"kind":"ObjectField","name":{"kind":"Name","value":"aiTaskId"},"value":{"kind":"Variable","name":{"kind":"Name","value":"aiTaskId"}}},{"kind":"ObjectField","name":{"kind":"Name","value":"parsedResume"},"value":{"kind":"Variable","name":{"kind":"Name","value":"parsedResume"}}}]}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"resume"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"title"}}]}},{"kind":"Field","name":{"kind":"Name","value":"errors"}}]}}]}}]} as unknown as DocumentNode<ImportParsedResumeMutation, ImportParsedResumeMutationVariables>;
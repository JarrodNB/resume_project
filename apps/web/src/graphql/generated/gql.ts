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
    "\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      input\n      pendingQuestions\n      errorMessage\n      acceptedAt\n      createdAt\n      job {\n        id\n      }\n    }\n  }\n": typeof types.AiTaskUpdatedDocument,
    "\n  subscription TaskOutcome {\n    aiTaskFinished {\n      cursor\n      outcome {\n        id\n        taskId\n        status\n        title\n        destination\n        completedAt\n      }\n    }\n  }\n": typeof types.TaskOutcomeDocument,
    "\n  query TaskOutcomes($after: String!, $through: String!) {\n    taskOutcomes(after: $after, through: $through) {\n      cursor\n      hasMore\n      outcomes {\n        id\n        taskId\n        status\n        title\n        destination\n        completedAt\n      }\n    }\n  }\n": typeof types.TaskOutcomesDocument,
    "\n  mutation DeleteExperience($id: ID!) {\n    deleteExperience(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteExperienceDocument,
    "\n  mutation DeleteProject($id: ID!) {\n    deleteProject(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteProjectDocument,
    "\n  mutation DeleteEducation($id: ID!) {\n    deleteEducation(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteEducationDocument,
    "\n  mutation DeleteSkill($id: ID!) {\n    deleteSkill(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteSkillDocument,
    "\n  mutation DeleteLibraryFact($id: ID!) {\n    deleteLibraryFact(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteLibraryFactDocument,
    "\n  mutation ClearCareerLibrary {\n    clearCareerLibrary(input: {}) {\n      errors\n    }\n  }\n": typeof types.ClearCareerLibraryDocument,
    "\n  mutation MergeExperiences($targetId: ID!, $sourceId: ID!) {\n    mergeExperiences(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": typeof types.MergeExperiencesDocument,
    "\n  mutation MergeProjects($targetId: ID!, $sourceId: ID!) {\n    mergeProjects(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": typeof types.MergeProjectsDocument,
    "\n  mutation MergeEducations($targetId: ID!, $sourceId: ID!) {\n    mergeEducations(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": typeof types.MergeEducationsDocument,
    "\n  mutation DeleteCertification($id: ID!) {\n    deleteCertification(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteCertificationDocument,
    "\n  mutation MergeCertifications($targetId: ID!, $sourceId: ID!) {\n    mergeCertifications(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": typeof types.MergeCertificationsDocument,
    "\n  query CareerLibrary {\n    me {\n      id\n      name\n      contactEmail\n      phone\n      location\n      links {\n        label\n        url\n      }\n      summary\n    }\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n        position\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    certifications {\n      id\n      name\n      issuer\n      issuedDate\n      issuedDatePrecision\n      expiryDate\n      expiryDatePrecision\n      credentialId\n      credentialUrl\n      description\n    }\n    skills {\n      id\n      name\n      category\n      position\n    }\n    libraryFacts {\n      id\n      requirement\n      response\n    }\n  }\n": typeof types.CareerLibraryDocument,
    "\n  mutation ReorderSkills($orderedIds: [ID!]!) {\n    reorderSkills(input: { orderedIds: $orderedIds }) {\n      errors\n    }\n  }\n": typeof types.ReorderSkillsDocument,
    "\n  mutation MoveExperienceHighlight($highlightId: ID!, $experienceId: ID!, $position: Int!) {\n    moveExperienceHighlight(input: { highlightId: $highlightId, experienceId: $experienceId, position: $position }) {\n      experience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      sourceExperience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      errors\n    }\n  }\n": typeof types.MoveExperienceHighlightDocument,
    "\n  mutation UpdateProfile($attributes: ProfileAttributesInput!) {\n    updateProfile(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.UpdateProfileDocument,
    "\n  mutation CreateExperience($attributes: ExperienceAttributesInput!, $highlights: [String!]) {\n    createExperience(input: { attributes: $attributes, highlights: $highlights }) {\n      errors\n    }\n  }\n": typeof types.CreateExperienceDocument,
    "\n  mutation UpdateExperience($id: ID!, $attributes: ExperienceAttributesInput!, $highlights: [String!]) {\n    updateExperience(input: { id: $id, attributes: $attributes, highlights: $highlights }) {\n      errors\n    }\n  }\n": typeof types.UpdateExperienceDocument,
    "\n  mutation CreateProject($attributes: ProjectAttributesInput!) {\n    createProject(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.CreateProjectDocument,
    "\n  mutation UpdateProject($id: ID!, $attributes: ProjectAttributesInput!) {\n    updateProject(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.UpdateProjectDocument,
    "\n  mutation CreateEducation($attributes: EducationAttributesInput!) {\n    createEducation(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.CreateEducationDocument,
    "\n  mutation UpdateEducation($id: ID!, $attributes: EducationAttributesInput!) {\n    updateEducation(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.UpdateEducationDocument,
    "\n  mutation CreateSkill($attributes: SkillAttributesInput!) {\n    createSkill(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.CreateSkillDocument,
    "\n  mutation UpdateSkill($id: ID!, $attributes: SkillAttributesInput!) {\n    updateSkill(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.UpdateSkillDocument,
    "\n  mutation CreateLibraryFact($attributes: LibraryFactAttributesInput!) {\n    createLibraryFact(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.CreateLibraryFactDocument,
    "\n  mutation UpdateLibraryFact($id: ID!, $attributes: LibraryFactAttributesInput!) {\n    updateLibraryFact(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.UpdateLibraryFactDocument,
    "\n  mutation CreateCertification($attributes: CertificationAttributesInput!) {\n    createCertification(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.CreateCertificationDocument,
    "\n  mutation UpdateCertification($id: ID!, $attributes: CertificationAttributesInput!) {\n    updateCertification(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.UpdateCertificationDocument,
    "\n  query LibraryEdit($kind: String!, $recordId: ID!) {\n    libraryEdit(kind: $kind, recordId: $recordId) {\n      stale\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n    }\n  }\n": typeof types.LibraryEditDocument,
    "\n  mutation StartLibraryEdit($kind: String, $recordId: ID, $feedback: String!, $previousTaskId: ID, $skip: Boolean!) {\n    startLibraryEdit(input: {kind: $kind, recordId: $recordId, feedback: $feedback, previousTaskId: $previousTaskId, skip: $skip}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n": typeof types.StartLibraryEditDocument,
    "\n  mutation AcceptLibraryEdit($aiTaskId: ID!) {\n    acceptLibraryEdit(input: {aiTaskId: $aiTaskId}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n": typeof types.AcceptLibraryEditDocument,
    "\n  mutation DiscardLibraryEdit($aiTaskId: ID!) {\n    discardLibraryEdit(input: {aiTaskId: $aiTaskId}) { aiTask { id status } errors }\n  }\n": typeof types.DiscardLibraryEditDocument,
    "\n  mutation AnswerLibraryReview($reviewTaskId: ID!, $kind: String!, $recordId: ID!, $answers: [LibraryReviewAnswerInput!]!) {\n    answerLibraryReview(input: {reviewTaskId: $reviewTaskId, kind: $kind, recordId: $recordId, answers: $answers}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n": typeof types.AnswerLibraryReviewDocument,
    "\n  query LibraryReview($section: String!) {\n    libraryReview(section: $section) {\n      aiTask { id status errorMessage }\n      assessments { kind recordId field color reason question questions reviewTaskId stale }\n    }\n  }\n": typeof types.LibraryReviewDocument,
    "\n  mutation ReviewLibrarySection($section: String!) {\n    reviewLibrarySection(input: { section: $section }) {\n      aiTask { id status errorMessage }\n      errors\n    }\n  }\n": typeof types.ReviewLibrarySectionDocument,
    "\n  mutation AnalyzeJobGaps($jobId: ID!) {\n    analyzeJobGaps(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n      errors\n    }\n  }\n": typeof types.AnalyzeJobGapsDocument,
    "\n  mutation SaveGapResponse($jobId: ID!, $requirement: String!, $body: String!, $addToLibrary: Boolean!) {\n    saveGapResponse(input: { jobId: $jobId, requirement: $requirement, body: $body, addToLibrary: $addToLibrary }) {\n      jobGapResponse {\n        id\n        requirement\n        body\n        libraryFact {\n          id\n        }\n      }\n      errors\n    }\n  }\n": typeof types.SaveGapResponseDocument,
    "\n  query JobPipeline {\n    jobPipeline {\n      nextStep\n      job {\n        id\n        title\n        company\n        location\n        stage\n      }\n    }\n  }\n": typeof types.JobPipelineDocument,
    "\n  query RunningAiTasks {\n    runningAiTasks {\n      id\n      label\n      destination\n    }\n  }\n": typeof types.RunningAiTasksDocument,
    "\n  query InterviewSets {\n    interviewQuestionSets {\n      id number setType createdAt\n      latestTask { id status errorMessage }\n    }\n  }\n": typeof types.InterviewSetsDocument,
    "\n  query InterviewSet($id: ID!) {\n    interviewQuestionSet(id: $id) {\n      id number setType createdAt\n      latestTask { id status errorMessage result }\n      questions { id avoided position questionText answerText answerRevision questionRevision feedback feedbackQuestionRevision feedbackAnswerRevision feedbackOutdated latestTask { id status taskType errorMessage } }\n    }\n  }\n": typeof types.InterviewSetDocument,
    "\n  mutation GenerateInterviewSet($setType: InterviewQuestionSetTypeEnum!) {\n    generateInterviewQuestionSet(input: { setType: $setType }) {\n      errors\n      aiTask { id input }\n    }\n  }\n": typeof types.GenerateInterviewSetDocument,
    "\n  mutation DeleteInterviewSet($id: ID!) {\n    deleteInterviewQuestionSet(input: { id: $id }) { errors }\n  }\n": typeof types.DeleteInterviewSetDocument,
    "\n  mutation SaveInterviewAnswer($questionSetId: ID!, $questionId: ID!, $answerText: String!) {\n    saveInterviewAnswer(input: { questionSetId: $questionSetId, questionId: $questionId, answerText: $answerText }) {\n      errors question { id answerText answerRevision feedbackOutdated }\n    }\n  }\n": typeof types.SaveInterviewAnswerDocument,
    "\n  mutation RequestInterviewFeedback($questionSetId: ID!, $questionId: ID!, $answerText: String!) {\n    requestInterviewAnswerFeedback(input: { questionSetId: $questionSetId, questionId: $questionId, answerText: $answerText }) {\n      errors aiTask { id status taskType errorMessage }\n    }\n  }\n": typeof types.RequestInterviewFeedbackDocument,
    "\n  mutation RegenerateInterviewQuestion($questionSetId: ID!, $questionId: ID!, $confirmed: Boolean!) {\n    regenerateInterviewQuestion(input: { questionSetId: $questionSetId, questionId: $questionId, confirmed: $confirmed }) {\n      errors aiTask { id status taskType errorMessage }\n    }\n  }\n": typeof types.RegenerateInterviewQuestionDocument,
    "\n  mutation AvoidInterviewQuestion($questionSetId: ID!, $questionId: ID!, $expectedRevision: Int!) {\n    avoidInterviewQuestion(input: {questionSetId: $questionSetId, questionId: $questionId, expectedRevision: $expectedRevision}) {\n      saved errors\n    }\n  }\n": typeof types.AvoidInterviewQuestionDocument,
    "\n  fragment InterviewSnapshot on InterviewSession {\n    id status interviewType executionMode speechPlaybackMode preparedRole revision answerCap currentQuestionPosition expiresAt\n    setup { questionCount questionFormat difficulty interviewer focusAreas }\n    jobContext { id title company description requirements responsibilities niceToHaves }\n    questions { id content questionType position acceptedAnswerCount skipped }\n    messages { id questionId kind position content avoided acknowledgement spokenContent careerReferences { id status attemptCount aiTaskId deadline references { sourceType sourceId title body } } clarification { id status explanation attemptCount aiTaskId deadline } }\n    operations { id questionId messageId kind status failureCode checkpoint submissionKey canRetry reviewTranscript expectedRevision }\n  }\n": typeof types.InterviewSnapshotFragmentDoc,
    "\n  query InterviewSession($id: ID!) { interviewSession(id: $id) { ...InterviewSnapshot } }\n": typeof types.InterviewSessionDocument,
    "\n  subscription InterviewSessionUpdated($id: ID!) { interviewSessionUpdated(id: $id) { ...InterviewSnapshot } }\n": typeof types.InterviewSessionUpdatedDocument,
    "\n  mutation StartInterview($careerFocus: String, $setup: InterviewSetupInput, $jobId: ID) { startInterview(input: {careerFocus: $careerFocus, setup: $setup, jobId: $jobId}) { interview { ...InterviewSnapshot } errors } }\n": typeof types.StartInterviewDocument,
    "\n  mutation AuthorizeInterviewRecording($input: AuthorizeInterviewRecordingInput!) {\n    authorizeInterviewRecording(input: $input) { upload { mediaId uploadUrl headers expiresIn } errors }\n  }\n": typeof types.AuthorizeInterviewRecordingDocument,
    "\n  mutation RegisterInterviewRecording($input: RegisterInterviewRecordingInput!) {\n    registerInterviewRecording(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n": typeof types.RegisterInterviewRecordingDocument,
    "\n  mutation SubmitInterviewTurn($input: SubmitInterviewTurnInput!) {\n    submitInterviewTurn(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n": typeof types.SubmitInterviewTurnDocument,
    "\n  mutation RetryInterviewOperation($input: RetryInterviewOperationInput!) {\n    retryInterviewOperation(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n": typeof types.RetryInterviewOperationDocument,
    "\n  mutation InterviewPlayback($input: InterviewPlaybackInput!) {\n    interviewPlayback(input: $input) { playback { playbackUrl expiresIn contentType } errors }\n  }\n": typeof types.InterviewPlaybackDocument,
    "\n  mutation BeginInterview($interviewId: ID!) {\n    beginInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors }\n  }\n": typeof types.BeginInterviewDocument,
    "\n  mutation AbandonInterview($interviewId: ID!) {\n    abandonInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors }\n  }\n": typeof types.AbandonInterviewDocument,
    "\n  query RecentInterviewSessions {\n    recentInterviewSessions { id status createdAt currentQuestionPosition questions { id } jobContext { id title company } }\n  }\n": typeof types.RecentInterviewSessionsDocument,
    "\n  query UnfinishedInterviewSession {\n    unfinishedInterviewSession { id status jobContext { id title company } }\n  }\n": typeof types.UnfinishedInterviewSessionDocument,
    "\n  mutation AbandonUnfinishedInterview($interviewId: ID!) {\n    abandonInterview(input: {interviewId: $interviewId}) { interview { id status } errors }\n  }\n": typeof types.AbandonUnfinishedInterviewDocument,
    "\n  mutation StartRecordedTranscription($input: StartRecordedTranscriptionInput!) {\n    startRecordedTranscription(input: $input) { operationId interview { ...InterviewSnapshot } errors }\n  }\n": typeof types.StartRecordedTranscriptionDocument,
    "\n  mutation CancelRecordedTranscription($input: CancelRecordedTranscriptionInput!) {\n    cancelRecordedTranscription(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n": typeof types.CancelRecordedTranscriptionDocument,
    "\n  mutation RequestInterviewClarification($input: RequestInterviewClarificationInput!) {\n    requestInterviewClarification(input: $input) {\n      clarification { id status explanation attemptCount aiTaskId deadline }\n      errors\n    }\n  }\n": typeof types.RequestInterviewClarificationDocument,
    "\n  mutation SkipInterviewQuestion($input: SkipInterviewQuestionInput!) {\n    skipInterviewQuestion(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n": typeof types.SkipInterviewQuestionDocument,
    "\n  mutation AvoidInterviewPrompt($interviewId: ID!, $messageId: ID!) {\n    avoidInterviewPrompt(input: {interviewId: $interviewId, messageId: $messageId}) { saved errors }\n  }\n": typeof types.AvoidInterviewPromptDocument,
    "\n  mutation RequestInterviewReferences($input: RequestInterviewReferencesInput!) {\n    requestInterviewReferences(input: $input) {\n      careerReferences { id status attemptCount aiTaskId deadline references { sourceType sourceId title body } }\n      errors\n    }\n  }\n": typeof types.RequestInterviewReferencesDocument,
    "fragment SavedInterviewRevision on InterviewSession { revision }": typeof types.SavedInterviewRevisionFragmentDoc,
    "\n  mutation AuthorizeInterviewTranscription($input: AuthorizeInterviewTranscriptionInput!) {\n    authorizeInterviewTranscription(input: $input) { captureId token errors }\n  }\n": typeof types.AuthorizeInterviewTranscriptionDocument,
    "\n  query JobBoardSearch($keyword: String!, $remoteOnly: Boolean!, $cursor: String, $experienceLevels: [JobBoardExperienceLevel!]!, $filters: JobBoardFiltersInput) {\n    jobBoardSearch(keyword: $keyword, remoteOnly: $remoteOnly, cursor: $cursor, experienceLevels: $experienceLevels, filters: $filters) {\n      listings {\n        id\n        title\n        company\n        location\n        description\n        remoteType\n        published\n        employmentType\n        salaryText\n        salaryCurrency\n        hasRemote\n        savedJob { id }\n      }\n      nextCursor\n      retrievedAt\n      stale\n      errors\n    }\n  }\n": typeof types.JobBoardSearchDocument,
    "\n  mutation ImportJobBoardListing($listingId: ID!) {\n    importJobBoardListing(input: { listingId: $listingId }) {\n      job { id }\n      warnings\n      errors\n    }\n  }\n": typeof types.ImportJobBoardListingDocument,
    "\n  query JobBoardLocations($query: String!) {\n    jobBoardLocations(query: $query) {\n      locations { kind providerId label }\n      errors\n    }\n  }\n": typeof types.JobBoardLocationsDocument,
    "\n  mutation RerankJobBoardListings($keyword: String!, $listingIds: [ID!]!) {\n    rerankJobBoardListings(input: { keyword: $keyword, listingIds: $listingIds }) {\n      aiTask { id status result errorMessage }\n      errors\n    }\n  }\n": typeof types.RerankJobBoardListingsDocument,
    "\n  subscription JobBoardReranking($id: ID!) {\n    aiTaskUpdated(id: $id) { id status result errorMessage }\n  }\n": typeof types.JobBoardRerankingDocument,
    "\n  query Jobs {\n    jobs {\n      id\n      title\n      company\n      location\n      stage\n      createdAt\n    }\n  }\n": typeof types.JobsDocument,
    "\n  query Job($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      location\n      stage\n      url\n      description\n      notes\n      appliedAt\n      requirements\n      responsibilities\n      niceToHaves\n      gapResponses {\n        id\n        requirement\n        body\n        libraryFact {\n          id\n        }\n      }\n      latestGapAnalysis {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n      resume {\n        id\n      }\n    }\n  }\n": typeof types.JobDocument,
    "\n  mutation CreateJob($attributes: JobAttributesInput!) {\n    createJob(input: { attributes: $attributes }) {\n      job {\n        id\n      }\n      errors\n    }\n  }\n": typeof types.CreateJobDocument,
    "\n  mutation UpdateJob($id: ID!, $attributes: JobAttributesInput!) {\n    updateJob(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": typeof types.UpdateJobDocument,
    "\n  mutation MoveJobToStage($id: ID!, $stage: JobStageEnum!) {\n    moveJobToStage(input: { id: $id, stage: $stage }) {\n      errors\n    }\n  }\n": typeof types.MoveJobToStageDocument,
    "\n  mutation DeleteJob($id: ID!) {\n    deleteJob(input: { id: $id }) {\n      errors\n    }\n  }\n": typeof types.DeleteJobDocument,
    "\n  mutation ScrapeJob($url: String!) {\n    scrapeJob(input: { url: $url }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": typeof types.ScrapeJobDocument,
    "\n  mutation ParseJobPosting($text: String!) {\n    parseJobPosting(input: { text: $text }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": typeof types.ParseJobPostingDocument,
    "\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": typeof types.ParseResumeDocument,
    "\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      aiTask {\n        id\n        acceptedAt\n        result\n      }\n      errors\n    }\n  }\n": typeof types.ImportParsedResumeDocument,
    "\n  query TailorJob($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      resume {\n        id\n        title\n        sections {\n          id\n          sectionType\n          title\n          position\n          content\n        }\n      }\n      latestTailoring {\n        id\n        status\n        acceptedAt\n        result\n        errorMessage\n      }\n    }\n  }\n": typeof types.TailorJobDocument,
    "\n  mutation StartResumeTailoring($jobId: ID!) {\n    startResumeTailoring(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": typeof types.StartResumeTailoringDocument,
    "\n  mutation SaveTailoredResume($aiTaskId: ID!, $sections: JSON) {\n    saveTailoredResume(input: { aiTaskId: $aiTaskId, sections: $sections }) {\n      resume {\n        id\n        title\n      }\n      errors\n    }\n  }\n": typeof types.SaveTailoredResumeDocument,
    "\n  mutation UpdateResume($id: ID!, $sections: JSON!) {\n    updateResume(input: { id: $id, sections: $sections }) {\n      resume {\n        id\n        title\n        sections {\n          id\n          sectionType\n          title\n          position\n          content\n        }\n      }\n      errors\n    }\n  }\n": typeof types.UpdateResumeDocument,
    "\n  mutation DeleteResume($id: ID!) {\n    deleteResume(input: { id: $id }) {\n      resume {\n        id\n      }\n      errors\n    }\n  }\n": typeof types.DeleteResumeDocument,
    "\n  query Resumes {\n    resumes {\n      id\n      title\n      updatedAt\n      job {\n        id\n        title\n        company\n      }\n    }\n  }\n": typeof types.ResumesDocument,
    "\n  query Resume($id: ID!) {\n    resume(id: $id) {\n      id\n      title\n      job {\n        id\n        title\n        company\n      }\n      sections {\n        id\n        sectionType\n        title\n        position\n        content\n      }\n    }\n  }\n": typeof types.ResumeDocument,
    "\n  query StudyGuideForJob($jobId: ID!, $cursor: String) {\n    job(id: $jobId) {\n      id\n      studyGuideDescriptionFingerprint\n      studyGuides(cursor: $cursor) { guides { id createdAt sourceDescriptionFingerprint outOfDate } nextCursor errors }\n      latestStudyGuideTask { id status errorMessage createdAt studyGuideRetryAfterSeconds }\n    }\n  }\n": typeof types.StudyGuideForJobDocument,
    "\n  query StudyGuideContent($jobId: ID!, $guideId: ID!) {\n    job(id: $jobId) {\n      id\n      studyGuide(id: $guideId) { id result createdAt studyGuideOutOfDate }\n    }\n  }\n": typeof types.StudyGuideContentDocument,
    "\n  mutation GenerateStudyGuide($jobId: ID!) {\n    generateStudyGuide(input: {jobId: $jobId}) {\n      aiTask { id status errorMessage createdAt studyGuideRetryAfterSeconds }\n      errors\n    }\n  }\n": typeof types.GenerateStudyGuideDocument,
};
const documents: Documents = {
    "\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      input\n      pendingQuestions\n      errorMessage\n      acceptedAt\n      createdAt\n      job {\n        id\n      }\n    }\n  }\n": types.AiTaskUpdatedDocument,
    "\n  subscription TaskOutcome {\n    aiTaskFinished {\n      cursor\n      outcome {\n        id\n        taskId\n        status\n        title\n        destination\n        completedAt\n      }\n    }\n  }\n": types.TaskOutcomeDocument,
    "\n  query TaskOutcomes($after: String!, $through: String!) {\n    taskOutcomes(after: $after, through: $through) {\n      cursor\n      hasMore\n      outcomes {\n        id\n        taskId\n        status\n        title\n        destination\n        completedAt\n      }\n    }\n  }\n": types.TaskOutcomesDocument,
    "\n  mutation DeleteExperience($id: ID!) {\n    deleteExperience(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteExperienceDocument,
    "\n  mutation DeleteProject($id: ID!) {\n    deleteProject(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteProjectDocument,
    "\n  mutation DeleteEducation($id: ID!) {\n    deleteEducation(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteEducationDocument,
    "\n  mutation DeleteSkill($id: ID!) {\n    deleteSkill(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteSkillDocument,
    "\n  mutation DeleteLibraryFact($id: ID!) {\n    deleteLibraryFact(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteLibraryFactDocument,
    "\n  mutation ClearCareerLibrary {\n    clearCareerLibrary(input: {}) {\n      errors\n    }\n  }\n": types.ClearCareerLibraryDocument,
    "\n  mutation MergeExperiences($targetId: ID!, $sourceId: ID!) {\n    mergeExperiences(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": types.MergeExperiencesDocument,
    "\n  mutation MergeProjects($targetId: ID!, $sourceId: ID!) {\n    mergeProjects(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": types.MergeProjectsDocument,
    "\n  mutation MergeEducations($targetId: ID!, $sourceId: ID!) {\n    mergeEducations(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": types.MergeEducationsDocument,
    "\n  mutation DeleteCertification($id: ID!) {\n    deleteCertification(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteCertificationDocument,
    "\n  mutation MergeCertifications($targetId: ID!, $sourceId: ID!) {\n    mergeCertifications(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n": types.MergeCertificationsDocument,
    "\n  query CareerLibrary {\n    me {\n      id\n      name\n      contactEmail\n      phone\n      location\n      links {\n        label\n        url\n      }\n      summary\n    }\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n        position\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    certifications {\n      id\n      name\n      issuer\n      issuedDate\n      issuedDatePrecision\n      expiryDate\n      expiryDatePrecision\n      credentialId\n      credentialUrl\n      description\n    }\n    skills {\n      id\n      name\n      category\n      position\n    }\n    libraryFacts {\n      id\n      requirement\n      response\n    }\n  }\n": types.CareerLibraryDocument,
    "\n  mutation ReorderSkills($orderedIds: [ID!]!) {\n    reorderSkills(input: { orderedIds: $orderedIds }) {\n      errors\n    }\n  }\n": types.ReorderSkillsDocument,
    "\n  mutation MoveExperienceHighlight($highlightId: ID!, $experienceId: ID!, $position: Int!) {\n    moveExperienceHighlight(input: { highlightId: $highlightId, experienceId: $experienceId, position: $position }) {\n      experience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      sourceExperience {\n        id\n        highlights {\n          id\n          content\n          position\n        }\n      }\n      errors\n    }\n  }\n": types.MoveExperienceHighlightDocument,
    "\n  mutation UpdateProfile($attributes: ProfileAttributesInput!) {\n    updateProfile(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": types.UpdateProfileDocument,
    "\n  mutation CreateExperience($attributes: ExperienceAttributesInput!, $highlights: [String!]) {\n    createExperience(input: { attributes: $attributes, highlights: $highlights }) {\n      errors\n    }\n  }\n": types.CreateExperienceDocument,
    "\n  mutation UpdateExperience($id: ID!, $attributes: ExperienceAttributesInput!, $highlights: [String!]) {\n    updateExperience(input: { id: $id, attributes: $attributes, highlights: $highlights }) {\n      errors\n    }\n  }\n": types.UpdateExperienceDocument,
    "\n  mutation CreateProject($attributes: ProjectAttributesInput!) {\n    createProject(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": types.CreateProjectDocument,
    "\n  mutation UpdateProject($id: ID!, $attributes: ProjectAttributesInput!) {\n    updateProject(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": types.UpdateProjectDocument,
    "\n  mutation CreateEducation($attributes: EducationAttributesInput!) {\n    createEducation(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": types.CreateEducationDocument,
    "\n  mutation UpdateEducation($id: ID!, $attributes: EducationAttributesInput!) {\n    updateEducation(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": types.UpdateEducationDocument,
    "\n  mutation CreateSkill($attributes: SkillAttributesInput!) {\n    createSkill(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": types.CreateSkillDocument,
    "\n  mutation UpdateSkill($id: ID!, $attributes: SkillAttributesInput!) {\n    updateSkill(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": types.UpdateSkillDocument,
    "\n  mutation CreateLibraryFact($attributes: LibraryFactAttributesInput!) {\n    createLibraryFact(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": types.CreateLibraryFactDocument,
    "\n  mutation UpdateLibraryFact($id: ID!, $attributes: LibraryFactAttributesInput!) {\n    updateLibraryFact(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": types.UpdateLibraryFactDocument,
    "\n  mutation CreateCertification($attributes: CertificationAttributesInput!) {\n    createCertification(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n": types.CreateCertificationDocument,
    "\n  mutation UpdateCertification($id: ID!, $attributes: CertificationAttributesInput!) {\n    updateCertification(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": types.UpdateCertificationDocument,
    "\n  query LibraryEdit($kind: String!, $recordId: ID!) {\n    libraryEdit(kind: $kind, recordId: $recordId) {\n      stale\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n    }\n  }\n": types.LibraryEditDocument,
    "\n  mutation StartLibraryEdit($kind: String, $recordId: ID, $feedback: String!, $previousTaskId: ID, $skip: Boolean!) {\n    startLibraryEdit(input: {kind: $kind, recordId: $recordId, feedback: $feedback, previousTaskId: $previousTaskId, skip: $skip}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n": types.StartLibraryEditDocument,
    "\n  mutation AcceptLibraryEdit($aiTaskId: ID!) {\n    acceptLibraryEdit(input: {aiTaskId: $aiTaskId}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n": types.AcceptLibraryEditDocument,
    "\n  mutation DiscardLibraryEdit($aiTaskId: ID!) {\n    discardLibraryEdit(input: {aiTaskId: $aiTaskId}) { aiTask { id status } errors }\n  }\n": types.DiscardLibraryEditDocument,
    "\n  mutation AnswerLibraryReview($reviewTaskId: ID!, $kind: String!, $recordId: ID!, $answers: [LibraryReviewAnswerInput!]!) {\n    answerLibraryReview(input: {reviewTaskId: $reviewTaskId, kind: $kind, recordId: $recordId, answers: $answers}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n": types.AnswerLibraryReviewDocument,
    "\n  query LibraryReview($section: String!) {\n    libraryReview(section: $section) {\n      aiTask { id status errorMessage }\n      assessments { kind recordId field color reason question questions reviewTaskId stale }\n    }\n  }\n": types.LibraryReviewDocument,
    "\n  mutation ReviewLibrarySection($section: String!) {\n    reviewLibrarySection(input: { section: $section }) {\n      aiTask { id status errorMessage }\n      errors\n    }\n  }\n": types.ReviewLibrarySectionDocument,
    "\n  mutation AnalyzeJobGaps($jobId: ID!) {\n    analyzeJobGaps(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n      errors\n    }\n  }\n": types.AnalyzeJobGapsDocument,
    "\n  mutation SaveGapResponse($jobId: ID!, $requirement: String!, $body: String!, $addToLibrary: Boolean!) {\n    saveGapResponse(input: { jobId: $jobId, requirement: $requirement, body: $body, addToLibrary: $addToLibrary }) {\n      jobGapResponse {\n        id\n        requirement\n        body\n        libraryFact {\n          id\n        }\n      }\n      errors\n    }\n  }\n": types.SaveGapResponseDocument,
    "\n  query JobPipeline {\n    jobPipeline {\n      nextStep\n      job {\n        id\n        title\n        company\n        location\n        stage\n      }\n    }\n  }\n": types.JobPipelineDocument,
    "\n  query RunningAiTasks {\n    runningAiTasks {\n      id\n      label\n      destination\n    }\n  }\n": types.RunningAiTasksDocument,
    "\n  query InterviewSets {\n    interviewQuestionSets {\n      id number setType createdAt\n      latestTask { id status errorMessage }\n    }\n  }\n": types.InterviewSetsDocument,
    "\n  query InterviewSet($id: ID!) {\n    interviewQuestionSet(id: $id) {\n      id number setType createdAt\n      latestTask { id status errorMessage result }\n      questions { id avoided position questionText answerText answerRevision questionRevision feedback feedbackQuestionRevision feedbackAnswerRevision feedbackOutdated latestTask { id status taskType errorMessage } }\n    }\n  }\n": types.InterviewSetDocument,
    "\n  mutation GenerateInterviewSet($setType: InterviewQuestionSetTypeEnum!) {\n    generateInterviewQuestionSet(input: { setType: $setType }) {\n      errors\n      aiTask { id input }\n    }\n  }\n": types.GenerateInterviewSetDocument,
    "\n  mutation DeleteInterviewSet($id: ID!) {\n    deleteInterviewQuestionSet(input: { id: $id }) { errors }\n  }\n": types.DeleteInterviewSetDocument,
    "\n  mutation SaveInterviewAnswer($questionSetId: ID!, $questionId: ID!, $answerText: String!) {\n    saveInterviewAnswer(input: { questionSetId: $questionSetId, questionId: $questionId, answerText: $answerText }) {\n      errors question { id answerText answerRevision feedbackOutdated }\n    }\n  }\n": types.SaveInterviewAnswerDocument,
    "\n  mutation RequestInterviewFeedback($questionSetId: ID!, $questionId: ID!, $answerText: String!) {\n    requestInterviewAnswerFeedback(input: { questionSetId: $questionSetId, questionId: $questionId, answerText: $answerText }) {\n      errors aiTask { id status taskType errorMessage }\n    }\n  }\n": types.RequestInterviewFeedbackDocument,
    "\n  mutation RegenerateInterviewQuestion($questionSetId: ID!, $questionId: ID!, $confirmed: Boolean!) {\n    regenerateInterviewQuestion(input: { questionSetId: $questionSetId, questionId: $questionId, confirmed: $confirmed }) {\n      errors aiTask { id status taskType errorMessage }\n    }\n  }\n": types.RegenerateInterviewQuestionDocument,
    "\n  mutation AvoidInterviewQuestion($questionSetId: ID!, $questionId: ID!, $expectedRevision: Int!) {\n    avoidInterviewQuestion(input: {questionSetId: $questionSetId, questionId: $questionId, expectedRevision: $expectedRevision}) {\n      saved errors\n    }\n  }\n": types.AvoidInterviewQuestionDocument,
    "\n  fragment InterviewSnapshot on InterviewSession {\n    id status interviewType executionMode speechPlaybackMode preparedRole revision answerCap currentQuestionPosition expiresAt\n    setup { questionCount questionFormat difficulty interviewer focusAreas }\n    jobContext { id title company description requirements responsibilities niceToHaves }\n    questions { id content questionType position acceptedAnswerCount skipped }\n    messages { id questionId kind position content avoided acknowledgement spokenContent careerReferences { id status attemptCount aiTaskId deadline references { sourceType sourceId title body } } clarification { id status explanation attemptCount aiTaskId deadline } }\n    operations { id questionId messageId kind status failureCode checkpoint submissionKey canRetry reviewTranscript expectedRevision }\n  }\n": types.InterviewSnapshotFragmentDoc,
    "\n  query InterviewSession($id: ID!) { interviewSession(id: $id) { ...InterviewSnapshot } }\n": types.InterviewSessionDocument,
    "\n  subscription InterviewSessionUpdated($id: ID!) { interviewSessionUpdated(id: $id) { ...InterviewSnapshot } }\n": types.InterviewSessionUpdatedDocument,
    "\n  mutation StartInterview($careerFocus: String, $setup: InterviewSetupInput, $jobId: ID) { startInterview(input: {careerFocus: $careerFocus, setup: $setup, jobId: $jobId}) { interview { ...InterviewSnapshot } errors } }\n": types.StartInterviewDocument,
    "\n  mutation AuthorizeInterviewRecording($input: AuthorizeInterviewRecordingInput!) {\n    authorizeInterviewRecording(input: $input) { upload { mediaId uploadUrl headers expiresIn } errors }\n  }\n": types.AuthorizeInterviewRecordingDocument,
    "\n  mutation RegisterInterviewRecording($input: RegisterInterviewRecordingInput!) {\n    registerInterviewRecording(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n": types.RegisterInterviewRecordingDocument,
    "\n  mutation SubmitInterviewTurn($input: SubmitInterviewTurnInput!) {\n    submitInterviewTurn(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n": types.SubmitInterviewTurnDocument,
    "\n  mutation RetryInterviewOperation($input: RetryInterviewOperationInput!) {\n    retryInterviewOperation(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n": types.RetryInterviewOperationDocument,
    "\n  mutation InterviewPlayback($input: InterviewPlaybackInput!) {\n    interviewPlayback(input: $input) { playback { playbackUrl expiresIn contentType } errors }\n  }\n": types.InterviewPlaybackDocument,
    "\n  mutation BeginInterview($interviewId: ID!) {\n    beginInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors }\n  }\n": types.BeginInterviewDocument,
    "\n  mutation AbandonInterview($interviewId: ID!) {\n    abandonInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors }\n  }\n": types.AbandonInterviewDocument,
    "\n  query RecentInterviewSessions {\n    recentInterviewSessions { id status createdAt currentQuestionPosition questions { id } jobContext { id title company } }\n  }\n": types.RecentInterviewSessionsDocument,
    "\n  query UnfinishedInterviewSession {\n    unfinishedInterviewSession { id status jobContext { id title company } }\n  }\n": types.UnfinishedInterviewSessionDocument,
    "\n  mutation AbandonUnfinishedInterview($interviewId: ID!) {\n    abandonInterview(input: {interviewId: $interviewId}) { interview { id status } errors }\n  }\n": types.AbandonUnfinishedInterviewDocument,
    "\n  mutation StartRecordedTranscription($input: StartRecordedTranscriptionInput!) {\n    startRecordedTranscription(input: $input) { operationId interview { ...InterviewSnapshot } errors }\n  }\n": types.StartRecordedTranscriptionDocument,
    "\n  mutation CancelRecordedTranscription($input: CancelRecordedTranscriptionInput!) {\n    cancelRecordedTranscription(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n": types.CancelRecordedTranscriptionDocument,
    "\n  mutation RequestInterviewClarification($input: RequestInterviewClarificationInput!) {\n    requestInterviewClarification(input: $input) {\n      clarification { id status explanation attemptCount aiTaskId deadline }\n      errors\n    }\n  }\n": types.RequestInterviewClarificationDocument,
    "\n  mutation SkipInterviewQuestion($input: SkipInterviewQuestionInput!) {\n    skipInterviewQuestion(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n": types.SkipInterviewQuestionDocument,
    "\n  mutation AvoidInterviewPrompt($interviewId: ID!, $messageId: ID!) {\n    avoidInterviewPrompt(input: {interviewId: $interviewId, messageId: $messageId}) { saved errors }\n  }\n": types.AvoidInterviewPromptDocument,
    "\n  mutation RequestInterviewReferences($input: RequestInterviewReferencesInput!) {\n    requestInterviewReferences(input: $input) {\n      careerReferences { id status attemptCount aiTaskId deadline references { sourceType sourceId title body } }\n      errors\n    }\n  }\n": types.RequestInterviewReferencesDocument,
    "fragment SavedInterviewRevision on InterviewSession { revision }": types.SavedInterviewRevisionFragmentDoc,
    "\n  mutation AuthorizeInterviewTranscription($input: AuthorizeInterviewTranscriptionInput!) {\n    authorizeInterviewTranscription(input: $input) { captureId token errors }\n  }\n": types.AuthorizeInterviewTranscriptionDocument,
    "\n  query JobBoardSearch($keyword: String!, $remoteOnly: Boolean!, $cursor: String, $experienceLevels: [JobBoardExperienceLevel!]!, $filters: JobBoardFiltersInput) {\n    jobBoardSearch(keyword: $keyword, remoteOnly: $remoteOnly, cursor: $cursor, experienceLevels: $experienceLevels, filters: $filters) {\n      listings {\n        id\n        title\n        company\n        location\n        description\n        remoteType\n        published\n        employmentType\n        salaryText\n        salaryCurrency\n        hasRemote\n        savedJob { id }\n      }\n      nextCursor\n      retrievedAt\n      stale\n      errors\n    }\n  }\n": types.JobBoardSearchDocument,
    "\n  mutation ImportJobBoardListing($listingId: ID!) {\n    importJobBoardListing(input: { listingId: $listingId }) {\n      job { id }\n      warnings\n      errors\n    }\n  }\n": types.ImportJobBoardListingDocument,
    "\n  query JobBoardLocations($query: String!) {\n    jobBoardLocations(query: $query) {\n      locations { kind providerId label }\n      errors\n    }\n  }\n": types.JobBoardLocationsDocument,
    "\n  mutation RerankJobBoardListings($keyword: String!, $listingIds: [ID!]!) {\n    rerankJobBoardListings(input: { keyword: $keyword, listingIds: $listingIds }) {\n      aiTask { id status result errorMessage }\n      errors\n    }\n  }\n": types.RerankJobBoardListingsDocument,
    "\n  subscription JobBoardReranking($id: ID!) {\n    aiTaskUpdated(id: $id) { id status result errorMessage }\n  }\n": types.JobBoardRerankingDocument,
    "\n  query Jobs {\n    jobs {\n      id\n      title\n      company\n      location\n      stage\n      createdAt\n    }\n  }\n": types.JobsDocument,
    "\n  query Job($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      location\n      stage\n      url\n      description\n      notes\n      appliedAt\n      requirements\n      responsibilities\n      niceToHaves\n      gapResponses {\n        id\n        requirement\n        body\n        libraryFact {\n          id\n        }\n      }\n      latestGapAnalysis {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n      resume {\n        id\n      }\n    }\n  }\n": types.JobDocument,
    "\n  mutation CreateJob($attributes: JobAttributesInput!) {\n    createJob(input: { attributes: $attributes }) {\n      job {\n        id\n      }\n      errors\n    }\n  }\n": types.CreateJobDocument,
    "\n  mutation UpdateJob($id: ID!, $attributes: JobAttributesInput!) {\n    updateJob(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n": types.UpdateJobDocument,
    "\n  mutation MoveJobToStage($id: ID!, $stage: JobStageEnum!) {\n    moveJobToStage(input: { id: $id, stage: $stage }) {\n      errors\n    }\n  }\n": types.MoveJobToStageDocument,
    "\n  mutation DeleteJob($id: ID!) {\n    deleteJob(input: { id: $id }) {\n      errors\n    }\n  }\n": types.DeleteJobDocument,
    "\n  mutation ScrapeJob($url: String!) {\n    scrapeJob(input: { url: $url }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": types.ScrapeJobDocument,
    "\n  mutation ParseJobPosting($text: String!) {\n    parseJobPosting(input: { text: $text }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": types.ParseJobPostingDocument,
    "\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": types.ParseResumeDocument,
    "\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      aiTask {\n        id\n        acceptedAt\n        result\n      }\n      errors\n    }\n  }\n": types.ImportParsedResumeDocument,
    "\n  query TailorJob($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      resume {\n        id\n        title\n        sections {\n          id\n          sectionType\n          title\n          position\n          content\n        }\n      }\n      latestTailoring {\n        id\n        status\n        acceptedAt\n        result\n        errorMessage\n      }\n    }\n  }\n": types.TailorJobDocument,
    "\n  mutation StartResumeTailoring($jobId: ID!) {\n    startResumeTailoring(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n": types.StartResumeTailoringDocument,
    "\n  mutation SaveTailoredResume($aiTaskId: ID!, $sections: JSON) {\n    saveTailoredResume(input: { aiTaskId: $aiTaskId, sections: $sections }) {\n      resume {\n        id\n        title\n      }\n      errors\n    }\n  }\n": types.SaveTailoredResumeDocument,
    "\n  mutation UpdateResume($id: ID!, $sections: JSON!) {\n    updateResume(input: { id: $id, sections: $sections }) {\n      resume {\n        id\n        title\n        sections {\n          id\n          sectionType\n          title\n          position\n          content\n        }\n      }\n      errors\n    }\n  }\n": types.UpdateResumeDocument,
    "\n  mutation DeleteResume($id: ID!) {\n    deleteResume(input: { id: $id }) {\n      resume {\n        id\n      }\n      errors\n    }\n  }\n": types.DeleteResumeDocument,
    "\n  query Resumes {\n    resumes {\n      id\n      title\n      updatedAt\n      job {\n        id\n        title\n        company\n      }\n    }\n  }\n": types.ResumesDocument,
    "\n  query Resume($id: ID!) {\n    resume(id: $id) {\n      id\n      title\n      job {\n        id\n        title\n        company\n      }\n      sections {\n        id\n        sectionType\n        title\n        position\n        content\n      }\n    }\n  }\n": types.ResumeDocument,
    "\n  query StudyGuideForJob($jobId: ID!, $cursor: String) {\n    job(id: $jobId) {\n      id\n      studyGuideDescriptionFingerprint\n      studyGuides(cursor: $cursor) { guides { id createdAt sourceDescriptionFingerprint outOfDate } nextCursor errors }\n      latestStudyGuideTask { id status errorMessage createdAt studyGuideRetryAfterSeconds }\n    }\n  }\n": types.StudyGuideForJobDocument,
    "\n  query StudyGuideContent($jobId: ID!, $guideId: ID!) {\n    job(id: $jobId) {\n      id\n      studyGuide(id: $guideId) { id result createdAt studyGuideOutOfDate }\n    }\n  }\n": types.StudyGuideContentDocument,
    "\n  mutation GenerateStudyGuide($jobId: ID!) {\n    generateStudyGuide(input: {jobId: $jobId}) {\n      aiTask { id status errorMessage createdAt studyGuideRetryAfterSeconds }\n      errors\n    }\n  }\n": types.GenerateStudyGuideDocument,
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
export function graphql(source: "\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      input\n      pendingQuestions\n      errorMessage\n      acceptedAt\n      createdAt\n      job {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  subscription AiTaskUpdated($id: ID!) {\n    aiTaskUpdated(id: $id) {\n      id\n      taskType\n      status\n      result\n      input\n      pendingQuestions\n      errorMessage\n      acceptedAt\n      createdAt\n      job {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription TaskOutcome {\n    aiTaskFinished {\n      cursor\n      outcome {\n        id\n        taskId\n        status\n        title\n        destination\n        completedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  subscription TaskOutcome {\n    aiTaskFinished {\n      cursor\n      outcome {\n        id\n        taskId\n        status\n        title\n        destination\n        completedAt\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TaskOutcomes($after: String!, $through: String!) {\n    taskOutcomes(after: $after, through: $through) {\n      cursor\n      hasMore\n      outcomes {\n        id\n        taskId\n        status\n        title\n        destination\n        completedAt\n      }\n    }\n  }\n"): (typeof documents)["\n  query TaskOutcomes($after: String!, $through: String!) {\n    taskOutcomes(after: $after, through: $through) {\n      cursor\n      hasMore\n      outcomes {\n        id\n        taskId\n        status\n        title\n        destination\n        completedAt\n      }\n    }\n  }\n"];
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
export function graphql(source: "\n  mutation DeleteLibraryFact($id: ID!) {\n    deleteLibraryFact(input: { id: $id }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteLibraryFact($id: ID!) {\n    deleteLibraryFact(input: { id: $id }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ClearCareerLibrary {\n    clearCareerLibrary(input: {}) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ClearCareerLibrary {\n    clearCareerLibrary(input: {}) {\n      errors\n    }\n  }\n"];
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
export function graphql(source: "\n  mutation DeleteCertification($id: ID!) {\n    deleteCertification(input: { id: $id }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteCertification($id: ID!) {\n    deleteCertification(input: { id: $id }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MergeCertifications($targetId: ID!, $sourceId: ID!) {\n    mergeCertifications(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation MergeCertifications($targetId: ID!, $sourceId: ID!) {\n    mergeCertifications(input: { targetId: $targetId, sourceId: $sourceId }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query CareerLibrary {\n    me {\n      id\n      name\n      contactEmail\n      phone\n      location\n      links {\n        label\n        url\n      }\n      summary\n    }\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n        position\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    certifications {\n      id\n      name\n      issuer\n      issuedDate\n      issuedDatePrecision\n      expiryDate\n      expiryDatePrecision\n      credentialId\n      credentialUrl\n      description\n    }\n    skills {\n      id\n      name\n      category\n      position\n    }\n    libraryFacts {\n      id\n      requirement\n      response\n    }\n  }\n"): (typeof documents)["\n  query CareerLibrary {\n    me {\n      id\n      name\n      contactEmail\n      phone\n      location\n      links {\n        label\n        url\n      }\n      summary\n    }\n    experiences {\n      id\n      company\n      title\n      location\n      startDate\n      endDate\n      description\n      highlights {\n        id\n        content\n        position\n      }\n    }\n    projects {\n      id\n      name\n      role\n      url\n      startDate\n      endDate\n      description\n    }\n    educations {\n      id\n      institution\n      degree\n      fieldOfStudy\n      startDate\n      endDate\n      description\n    }\n    certifications {\n      id\n      name\n      issuer\n      issuedDate\n      issuedDatePrecision\n      expiryDate\n      expiryDatePrecision\n      credentialId\n      credentialUrl\n      description\n    }\n    skills {\n      id\n      name\n      category\n      position\n    }\n    libraryFacts {\n      id\n      requirement\n      response\n    }\n  }\n"];
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
export function graphql(source: "\n  mutation UpdateProfile($attributes: ProfileAttributesInput!) {\n    updateProfile(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateProfile($attributes: ProfileAttributesInput!) {\n    updateProfile(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateExperience($attributes: ExperienceAttributesInput!, $highlights: [String!]) {\n    createExperience(input: { attributes: $attributes, highlights: $highlights }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation CreateExperience($attributes: ExperienceAttributesInput!, $highlights: [String!]) {\n    createExperience(input: { attributes: $attributes, highlights: $highlights }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateExperience($id: ID!, $attributes: ExperienceAttributesInput!, $highlights: [String!]) {\n    updateExperience(input: { id: $id, attributes: $attributes, highlights: $highlights }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateExperience($id: ID!, $attributes: ExperienceAttributesInput!, $highlights: [String!]) {\n    updateExperience(input: { id: $id, attributes: $attributes, highlights: $highlights }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateProject($attributes: ProjectAttributesInput!) {\n    createProject(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation CreateProject($attributes: ProjectAttributesInput!) {\n    createProject(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateProject($id: ID!, $attributes: ProjectAttributesInput!) {\n    updateProject(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateProject($id: ID!, $attributes: ProjectAttributesInput!) {\n    updateProject(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateEducation($attributes: EducationAttributesInput!) {\n    createEducation(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation CreateEducation($attributes: EducationAttributesInput!) {\n    createEducation(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateEducation($id: ID!, $attributes: EducationAttributesInput!) {\n    updateEducation(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateEducation($id: ID!, $attributes: EducationAttributesInput!) {\n    updateEducation(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateSkill($attributes: SkillAttributesInput!) {\n    createSkill(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation CreateSkill($attributes: SkillAttributesInput!) {\n    createSkill(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateSkill($id: ID!, $attributes: SkillAttributesInput!) {\n    updateSkill(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateSkill($id: ID!, $attributes: SkillAttributesInput!) {\n    updateSkill(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateLibraryFact($attributes: LibraryFactAttributesInput!) {\n    createLibraryFact(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation CreateLibraryFact($attributes: LibraryFactAttributesInput!) {\n    createLibraryFact(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateLibraryFact($id: ID!, $attributes: LibraryFactAttributesInput!) {\n    updateLibraryFact(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateLibraryFact($id: ID!, $attributes: LibraryFactAttributesInput!) {\n    updateLibraryFact(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateCertification($attributes: CertificationAttributesInput!) {\n    createCertification(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation CreateCertification($attributes: CertificationAttributesInput!) {\n    createCertification(input: { attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateCertification($id: ID!, $attributes: CertificationAttributesInput!) {\n    updateCertification(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateCertification($id: ID!, $attributes: CertificationAttributesInput!) {\n    updateCertification(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query LibraryEdit($kind: String!, $recordId: ID!) {\n    libraryEdit(kind: $kind, recordId: $recordId) {\n      stale\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n    }\n  }\n"): (typeof documents)["\n  query LibraryEdit($kind: String!, $recordId: ID!) {\n    libraryEdit(kind: $kind, recordId: $recordId) {\n      stale\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartLibraryEdit($kind: String, $recordId: ID, $feedback: String!, $previousTaskId: ID, $skip: Boolean!) {\n    startLibraryEdit(input: {kind: $kind, recordId: $recordId, feedback: $feedback, previousTaskId: $previousTaskId, skip: $skip}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation StartLibraryEdit($kind: String, $recordId: ID, $feedback: String!, $previousTaskId: ID, $skip: Boolean!) {\n    startLibraryEdit(input: {kind: $kind, recordId: $recordId, feedback: $feedback, previousTaskId: $previousTaskId, skip: $skip}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AcceptLibraryEdit($aiTaskId: ID!) {\n    acceptLibraryEdit(input: {aiTaskId: $aiTaskId}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation AcceptLibraryEdit($aiTaskId: ID!) {\n    acceptLibraryEdit(input: {aiTaskId: $aiTaskId}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DiscardLibraryEdit($aiTaskId: ID!) {\n    discardLibraryEdit(input: {aiTaskId: $aiTaskId}) { aiTask { id status } errors }\n  }\n"): (typeof documents)["\n  mutation DiscardLibraryEdit($aiTaskId: ID!) {\n    discardLibraryEdit(input: {aiTaskId: $aiTaskId}) { aiTask { id status } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AnswerLibraryReview($reviewTaskId: ID!, $kind: String!, $recordId: ID!, $answers: [LibraryReviewAnswerInput!]!) {\n    answerLibraryReview(input: {reviewTaskId: $reviewTaskId, kind: $kind, recordId: $recordId, answers: $answers}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation AnswerLibraryReview($reviewTaskId: ID!, $kind: String!, $recordId: ID!, $answers: [LibraryReviewAnswerInput!]!) {\n    answerLibraryReview(input: {reviewTaskId: $reviewTaskId, kind: $kind, recordId: $recordId, answers: $answers}) {\n      aiTask { id status result input pendingQuestions errorMessage acceptedAt }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query LibraryReview($section: String!) {\n    libraryReview(section: $section) {\n      aiTask { id status errorMessage }\n      assessments { kind recordId field color reason question questions reviewTaskId stale }\n    }\n  }\n"): (typeof documents)["\n  query LibraryReview($section: String!) {\n    libraryReview(section: $section) {\n      aiTask { id status errorMessage }\n      assessments { kind recordId field color reason question questions reviewTaskId stale }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ReviewLibrarySection($section: String!) {\n    reviewLibrarySection(input: { section: $section }) {\n      aiTask { id status errorMessage }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ReviewLibrarySection($section: String!) {\n    reviewLibrarySection(input: { section: $section }) {\n      aiTask { id status errorMessage }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AnalyzeJobGaps($jobId: ID!) {\n    analyzeJobGaps(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation AnalyzeJobGaps($jobId: ID!) {\n    analyzeJobGaps(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SaveGapResponse($jobId: ID!, $requirement: String!, $body: String!, $addToLibrary: Boolean!) {\n    saveGapResponse(input: { jobId: $jobId, requirement: $requirement, body: $body, addToLibrary: $addToLibrary }) {\n      jobGapResponse {\n        id\n        requirement\n        body\n        libraryFact {\n          id\n        }\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation SaveGapResponse($jobId: ID!, $requirement: String!, $body: String!, $addToLibrary: Boolean!) {\n    saveGapResponse(input: { jobId: $jobId, requirement: $requirement, body: $body, addToLibrary: $addToLibrary }) {\n      jobGapResponse {\n        id\n        requirement\n        body\n        libraryFact {\n          id\n        }\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query JobPipeline {\n    jobPipeline {\n      nextStep\n      job {\n        id\n        title\n        company\n        location\n        stage\n      }\n    }\n  }\n"): (typeof documents)["\n  query JobPipeline {\n    jobPipeline {\n      nextStep\n      job {\n        id\n        title\n        company\n        location\n        stage\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query RunningAiTasks {\n    runningAiTasks {\n      id\n      label\n      destination\n    }\n  }\n"): (typeof documents)["\n  query RunningAiTasks {\n    runningAiTasks {\n      id\n      label\n      destination\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query InterviewSets {\n    interviewQuestionSets {\n      id number setType createdAt\n      latestTask { id status errorMessage }\n    }\n  }\n"): (typeof documents)["\n  query InterviewSets {\n    interviewQuestionSets {\n      id number setType createdAt\n      latestTask { id status errorMessage }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query InterviewSet($id: ID!) {\n    interviewQuestionSet(id: $id) {\n      id number setType createdAt\n      latestTask { id status errorMessage result }\n      questions { id avoided position questionText answerText answerRevision questionRevision feedback feedbackQuestionRevision feedbackAnswerRevision feedbackOutdated latestTask { id status taskType errorMessage } }\n    }\n  }\n"): (typeof documents)["\n  query InterviewSet($id: ID!) {\n    interviewQuestionSet(id: $id) {\n      id number setType createdAt\n      latestTask { id status errorMessage result }\n      questions { id avoided position questionText answerText answerRevision questionRevision feedback feedbackQuestionRevision feedbackAnswerRevision feedbackOutdated latestTask { id status taskType errorMessage } }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation GenerateInterviewSet($setType: InterviewQuestionSetTypeEnum!) {\n    generateInterviewQuestionSet(input: { setType: $setType }) {\n      errors\n      aiTask { id input }\n    }\n  }\n"): (typeof documents)["\n  mutation GenerateInterviewSet($setType: InterviewQuestionSetTypeEnum!) {\n    generateInterviewQuestionSet(input: { setType: $setType }) {\n      errors\n      aiTask { id input }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteInterviewSet($id: ID!) {\n    deleteInterviewQuestionSet(input: { id: $id }) { errors }\n  }\n"): (typeof documents)["\n  mutation DeleteInterviewSet($id: ID!) {\n    deleteInterviewQuestionSet(input: { id: $id }) { errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SaveInterviewAnswer($questionSetId: ID!, $questionId: ID!, $answerText: String!) {\n    saveInterviewAnswer(input: { questionSetId: $questionSetId, questionId: $questionId, answerText: $answerText }) {\n      errors question { id answerText answerRevision feedbackOutdated }\n    }\n  }\n"): (typeof documents)["\n  mutation SaveInterviewAnswer($questionSetId: ID!, $questionId: ID!, $answerText: String!) {\n    saveInterviewAnswer(input: { questionSetId: $questionSetId, questionId: $questionId, answerText: $answerText }) {\n      errors question { id answerText answerRevision feedbackOutdated }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestInterviewFeedback($questionSetId: ID!, $questionId: ID!, $answerText: String!) {\n    requestInterviewAnswerFeedback(input: { questionSetId: $questionSetId, questionId: $questionId, answerText: $answerText }) {\n      errors aiTask { id status taskType errorMessage }\n    }\n  }\n"): (typeof documents)["\n  mutation RequestInterviewFeedback($questionSetId: ID!, $questionId: ID!, $answerText: String!) {\n    requestInterviewAnswerFeedback(input: { questionSetId: $questionSetId, questionId: $questionId, answerText: $answerText }) {\n      errors aiTask { id status taskType errorMessage }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RegenerateInterviewQuestion($questionSetId: ID!, $questionId: ID!, $confirmed: Boolean!) {\n    regenerateInterviewQuestion(input: { questionSetId: $questionSetId, questionId: $questionId, confirmed: $confirmed }) {\n      errors aiTask { id status taskType errorMessage }\n    }\n  }\n"): (typeof documents)["\n  mutation RegenerateInterviewQuestion($questionSetId: ID!, $questionId: ID!, $confirmed: Boolean!) {\n    regenerateInterviewQuestion(input: { questionSetId: $questionSetId, questionId: $questionId, confirmed: $confirmed }) {\n      errors aiTask { id status taskType errorMessage }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AvoidInterviewQuestion($questionSetId: ID!, $questionId: ID!, $expectedRevision: Int!) {\n    avoidInterviewQuestion(input: {questionSetId: $questionSetId, questionId: $questionId, expectedRevision: $expectedRevision}) {\n      saved errors\n    }\n  }\n"): (typeof documents)["\n  mutation AvoidInterviewQuestion($questionSetId: ID!, $questionId: ID!, $expectedRevision: Int!) {\n    avoidInterviewQuestion(input: {questionSetId: $questionSetId, questionId: $questionId, expectedRevision: $expectedRevision}) {\n      saved errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment InterviewSnapshot on InterviewSession {\n    id status interviewType executionMode speechPlaybackMode preparedRole revision answerCap currentQuestionPosition expiresAt\n    setup { questionCount questionFormat difficulty interviewer focusAreas }\n    jobContext { id title company description requirements responsibilities niceToHaves }\n    questions { id content questionType position acceptedAnswerCount skipped }\n    messages { id questionId kind position content avoided acknowledgement spokenContent careerReferences { id status attemptCount aiTaskId deadline references { sourceType sourceId title body } } clarification { id status explanation attemptCount aiTaskId deadline } }\n    operations { id questionId messageId kind status failureCode checkpoint submissionKey canRetry reviewTranscript expectedRevision }\n  }\n"): (typeof documents)["\n  fragment InterviewSnapshot on InterviewSession {\n    id status interviewType executionMode speechPlaybackMode preparedRole revision answerCap currentQuestionPosition expiresAt\n    setup { questionCount questionFormat difficulty interviewer focusAreas }\n    jobContext { id title company description requirements responsibilities niceToHaves }\n    questions { id content questionType position acceptedAnswerCount skipped }\n    messages { id questionId kind position content avoided acknowledgement spokenContent careerReferences { id status attemptCount aiTaskId deadline references { sourceType sourceId title body } } clarification { id status explanation attemptCount aiTaskId deadline } }\n    operations { id questionId messageId kind status failureCode checkpoint submissionKey canRetry reviewTranscript expectedRevision }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query InterviewSession($id: ID!) { interviewSession(id: $id) { ...InterviewSnapshot } }\n"): (typeof documents)["\n  query InterviewSession($id: ID!) { interviewSession(id: $id) { ...InterviewSnapshot } }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription InterviewSessionUpdated($id: ID!) { interviewSessionUpdated(id: $id) { ...InterviewSnapshot } }\n"): (typeof documents)["\n  subscription InterviewSessionUpdated($id: ID!) { interviewSessionUpdated(id: $id) { ...InterviewSnapshot } }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartInterview($careerFocus: String, $setup: InterviewSetupInput, $jobId: ID) { startInterview(input: {careerFocus: $careerFocus, setup: $setup, jobId: $jobId}) { interview { ...InterviewSnapshot } errors } }\n"): (typeof documents)["\n  mutation StartInterview($careerFocus: String, $setup: InterviewSetupInput, $jobId: ID) { startInterview(input: {careerFocus: $careerFocus, setup: $setup, jobId: $jobId}) { interview { ...InterviewSnapshot } errors } }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AuthorizeInterviewRecording($input: AuthorizeInterviewRecordingInput!) {\n    authorizeInterviewRecording(input: $input) { upload { mediaId uploadUrl headers expiresIn } errors }\n  }\n"): (typeof documents)["\n  mutation AuthorizeInterviewRecording($input: AuthorizeInterviewRecordingInput!) {\n    authorizeInterviewRecording(input: $input) { upload { mediaId uploadUrl headers expiresIn } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RegisterInterviewRecording($input: RegisterInterviewRecordingInput!) {\n    registerInterviewRecording(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n"): (typeof documents)["\n  mutation RegisterInterviewRecording($input: RegisterInterviewRecordingInput!) {\n    registerInterviewRecording(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SubmitInterviewTurn($input: SubmitInterviewTurnInput!) {\n    submitInterviewTurn(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n"): (typeof documents)["\n  mutation SubmitInterviewTurn($input: SubmitInterviewTurnInput!) {\n    submitInterviewTurn(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RetryInterviewOperation($input: RetryInterviewOperationInput!) {\n    retryInterviewOperation(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n"): (typeof documents)["\n  mutation RetryInterviewOperation($input: RetryInterviewOperationInput!) {\n    retryInterviewOperation(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation InterviewPlayback($input: InterviewPlaybackInput!) {\n    interviewPlayback(input: $input) { playback { playbackUrl expiresIn contentType } errors }\n  }\n"): (typeof documents)["\n  mutation InterviewPlayback($input: InterviewPlaybackInput!) {\n    interviewPlayback(input: $input) { playback { playbackUrl expiresIn contentType } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation BeginInterview($interviewId: ID!) {\n    beginInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors }\n  }\n"): (typeof documents)["\n  mutation BeginInterview($interviewId: ID!) {\n    beginInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AbandonInterview($interviewId: ID!) {\n    abandonInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors }\n  }\n"): (typeof documents)["\n  mutation AbandonInterview($interviewId: ID!) {\n    abandonInterview(input: {interviewId: $interviewId}) { interview { ...InterviewSnapshot } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query RecentInterviewSessions {\n    recentInterviewSessions { id status createdAt currentQuestionPosition questions { id } jobContext { id title company } }\n  }\n"): (typeof documents)["\n  query RecentInterviewSessions {\n    recentInterviewSessions { id status createdAt currentQuestionPosition questions { id } jobContext { id title company } }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query UnfinishedInterviewSession {\n    unfinishedInterviewSession { id status jobContext { id title company } }\n  }\n"): (typeof documents)["\n  query UnfinishedInterviewSession {\n    unfinishedInterviewSession { id status jobContext { id title company } }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AbandonUnfinishedInterview($interviewId: ID!) {\n    abandonInterview(input: {interviewId: $interviewId}) { interview { id status } errors }\n  }\n"): (typeof documents)["\n  mutation AbandonUnfinishedInterview($interviewId: ID!) {\n    abandonInterview(input: {interviewId: $interviewId}) { interview { id status } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartRecordedTranscription($input: StartRecordedTranscriptionInput!) {\n    startRecordedTranscription(input: $input) { operationId interview { ...InterviewSnapshot } errors }\n  }\n"): (typeof documents)["\n  mutation StartRecordedTranscription($input: StartRecordedTranscriptionInput!) {\n    startRecordedTranscription(input: $input) { operationId interview { ...InterviewSnapshot } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CancelRecordedTranscription($input: CancelRecordedTranscriptionInput!) {\n    cancelRecordedTranscription(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n"): (typeof documents)["\n  mutation CancelRecordedTranscription($input: CancelRecordedTranscriptionInput!) {\n    cancelRecordedTranscription(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestInterviewClarification($input: RequestInterviewClarificationInput!) {\n    requestInterviewClarification(input: $input) {\n      clarification { id status explanation attemptCount aiTaskId deadline }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation RequestInterviewClarification($input: RequestInterviewClarificationInput!) {\n    requestInterviewClarification(input: $input) {\n      clarification { id status explanation attemptCount aiTaskId deadline }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SkipInterviewQuestion($input: SkipInterviewQuestionInput!) {\n    skipInterviewQuestion(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n"): (typeof documents)["\n  mutation SkipInterviewQuestion($input: SkipInterviewQuestionInput!) {\n    skipInterviewQuestion(input: $input) { interview { ...InterviewSnapshot } errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AvoidInterviewPrompt($interviewId: ID!, $messageId: ID!) {\n    avoidInterviewPrompt(input: {interviewId: $interviewId, messageId: $messageId}) { saved errors }\n  }\n"): (typeof documents)["\n  mutation AvoidInterviewPrompt($interviewId: ID!, $messageId: ID!) {\n    avoidInterviewPrompt(input: {interviewId: $interviewId, messageId: $messageId}) { saved errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RequestInterviewReferences($input: RequestInterviewReferencesInput!) {\n    requestInterviewReferences(input: $input) {\n      careerReferences { id status attemptCount aiTaskId deadline references { sourceType sourceId title body } }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation RequestInterviewReferences($input: RequestInterviewReferencesInput!) {\n    requestInterviewReferences(input: $input) {\n      careerReferences { id status attemptCount aiTaskId deadline references { sourceType sourceId title body } }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "fragment SavedInterviewRevision on InterviewSession { revision }"): (typeof documents)["fragment SavedInterviewRevision on InterviewSession { revision }"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation AuthorizeInterviewTranscription($input: AuthorizeInterviewTranscriptionInput!) {\n    authorizeInterviewTranscription(input: $input) { captureId token errors }\n  }\n"): (typeof documents)["\n  mutation AuthorizeInterviewTranscription($input: AuthorizeInterviewTranscriptionInput!) {\n    authorizeInterviewTranscription(input: $input) { captureId token errors }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query JobBoardSearch($keyword: String!, $remoteOnly: Boolean!, $cursor: String, $experienceLevels: [JobBoardExperienceLevel!]!, $filters: JobBoardFiltersInput) {\n    jobBoardSearch(keyword: $keyword, remoteOnly: $remoteOnly, cursor: $cursor, experienceLevels: $experienceLevels, filters: $filters) {\n      listings {\n        id\n        title\n        company\n        location\n        description\n        remoteType\n        published\n        employmentType\n        salaryText\n        salaryCurrency\n        hasRemote\n        savedJob { id }\n      }\n      nextCursor\n      retrievedAt\n      stale\n      errors\n    }\n  }\n"): (typeof documents)["\n  query JobBoardSearch($keyword: String!, $remoteOnly: Boolean!, $cursor: String, $experienceLevels: [JobBoardExperienceLevel!]!, $filters: JobBoardFiltersInput) {\n    jobBoardSearch(keyword: $keyword, remoteOnly: $remoteOnly, cursor: $cursor, experienceLevels: $experienceLevels, filters: $filters) {\n      listings {\n        id\n        title\n        company\n        location\n        description\n        remoteType\n        published\n        employmentType\n        salaryText\n        salaryCurrency\n        hasRemote\n        savedJob { id }\n      }\n      nextCursor\n      retrievedAt\n      stale\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ImportJobBoardListing($listingId: ID!) {\n    importJobBoardListing(input: { listingId: $listingId }) {\n      job { id }\n      warnings\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ImportJobBoardListing($listingId: ID!) {\n    importJobBoardListing(input: { listingId: $listingId }) {\n      job { id }\n      warnings\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query JobBoardLocations($query: String!) {\n    jobBoardLocations(query: $query) {\n      locations { kind providerId label }\n      errors\n    }\n  }\n"): (typeof documents)["\n  query JobBoardLocations($query: String!) {\n    jobBoardLocations(query: $query) {\n      locations { kind providerId label }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RerankJobBoardListings($keyword: String!, $listingIds: [ID!]!) {\n    rerankJobBoardListings(input: { keyword: $keyword, listingIds: $listingIds }) {\n      aiTask { id status result errorMessage }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation RerankJobBoardListings($keyword: String!, $listingIds: [ID!]!) {\n    rerankJobBoardListings(input: { keyword: $keyword, listingIds: $listingIds }) {\n      aiTask { id status result errorMessage }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription JobBoardReranking($id: ID!) {\n    aiTaskUpdated(id: $id) { id status result errorMessage }\n  }\n"): (typeof documents)["\n  subscription JobBoardReranking($id: ID!) {\n    aiTaskUpdated(id: $id) { id status result errorMessage }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Jobs {\n    jobs {\n      id\n      title\n      company\n      location\n      stage\n      createdAt\n    }\n  }\n"): (typeof documents)["\n  query Jobs {\n    jobs {\n      id\n      title\n      company\n      location\n      stage\n      createdAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Job($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      location\n      stage\n      url\n      description\n      notes\n      appliedAt\n      requirements\n      responsibilities\n      niceToHaves\n      gapResponses {\n        id\n        requirement\n        body\n        libraryFact {\n          id\n        }\n      }\n      latestGapAnalysis {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n      resume {\n        id\n      }\n    }\n  }\n"): (typeof documents)["\n  query Job($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      location\n      stage\n      url\n      description\n      notes\n      appliedAt\n      requirements\n      responsibilities\n      niceToHaves\n      gapResponses {\n        id\n        requirement\n        body\n        libraryFact {\n          id\n        }\n      }\n      latestGapAnalysis {\n        id\n        status\n        result\n        errorMessage\n        createdAt\n      }\n      resume {\n        id\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateJob($attributes: JobAttributesInput!) {\n    createJob(input: { attributes: $attributes }) {\n      job {\n        id\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation CreateJob($attributes: JobAttributesInput!) {\n    createJob(input: { attributes: $attributes }) {\n      job {\n        id\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateJob($id: ID!, $attributes: JobAttributesInput!) {\n    updateJob(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateJob($id: ID!, $attributes: JobAttributesInput!) {\n    updateJob(input: { id: $id, attributes: $attributes }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation MoveJobToStage($id: ID!, $stage: JobStageEnum!) {\n    moveJobToStage(input: { id: $id, stage: $stage }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation MoveJobToStage($id: ID!, $stage: JobStageEnum!) {\n    moveJobToStage(input: { id: $id, stage: $stage }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteJob($id: ID!) {\n    deleteJob(input: { id: $id }) {\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteJob($id: ID!) {\n    deleteJob(input: { id: $id }) {\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ScrapeJob($url: String!) {\n    scrapeJob(input: { url: $url }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ScrapeJob($url: String!) {\n    scrapeJob(input: { url: $url }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ParseJobPosting($text: String!) {\n    parseJobPosting(input: { text: $text }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ParseJobPosting($text: String!) {\n    parseJobPosting(input: { text: $text }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ParseResume($file: Upload!) {\n    parseResume(input: { file: $file }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      aiTask {\n        id\n        acceptedAt\n        result\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation ImportParsedResume($aiTaskId: ID!, $parsedResume: JSON!) {\n    importParsedResume(input: { aiTaskId: $aiTaskId, parsedResume: $parsedResume }) {\n      aiTask {\n        id\n        acceptedAt\n        result\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query TailorJob($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      resume {\n        id\n        title\n        sections {\n          id\n          sectionType\n          title\n          position\n          content\n        }\n      }\n      latestTailoring {\n        id\n        status\n        acceptedAt\n        result\n        errorMessage\n      }\n    }\n  }\n"): (typeof documents)["\n  query TailorJob($id: ID!) {\n    job(id: $id) {\n      id\n      title\n      company\n      resume {\n        id\n        title\n        sections {\n          id\n          sectionType\n          title\n          position\n          content\n        }\n      }\n      latestTailoring {\n        id\n        status\n        acceptedAt\n        result\n        errorMessage\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartResumeTailoring($jobId: ID!) {\n    startResumeTailoring(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation StartResumeTailoring($jobId: ID!) {\n    startResumeTailoring(input: { jobId: $jobId }) {\n      aiTask {\n        id\n        status\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SaveTailoredResume($aiTaskId: ID!, $sections: JSON) {\n    saveTailoredResume(input: { aiTaskId: $aiTaskId, sections: $sections }) {\n      resume {\n        id\n        title\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation SaveTailoredResume($aiTaskId: ID!, $sections: JSON) {\n    saveTailoredResume(input: { aiTaskId: $aiTaskId, sections: $sections }) {\n      resume {\n        id\n        title\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UpdateResume($id: ID!, $sections: JSON!) {\n    updateResume(input: { id: $id, sections: $sections }) {\n      resume {\n        id\n        title\n        sections {\n          id\n          sectionType\n          title\n          position\n          content\n        }\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation UpdateResume($id: ID!, $sections: JSON!) {\n    updateResume(input: { id: $id, sections: $sections }) {\n      resume {\n        id\n        title\n        sections {\n          id\n          sectionType\n          title\n          position\n          content\n        }\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation DeleteResume($id: ID!) {\n    deleteResume(input: { id: $id }) {\n      resume {\n        id\n      }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation DeleteResume($id: ID!) {\n    deleteResume(input: { id: $id }) {\n      resume {\n        id\n      }\n      errors\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Resumes {\n    resumes {\n      id\n      title\n      updatedAt\n      job {\n        id\n        title\n        company\n      }\n    }\n  }\n"): (typeof documents)["\n  query Resumes {\n    resumes {\n      id\n      title\n      updatedAt\n      job {\n        id\n        title\n        company\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Resume($id: ID!) {\n    resume(id: $id) {\n      id\n      title\n      job {\n        id\n        title\n        company\n      }\n      sections {\n        id\n        sectionType\n        title\n        position\n        content\n      }\n    }\n  }\n"): (typeof documents)["\n  query Resume($id: ID!) {\n    resume(id: $id) {\n      id\n      title\n      job {\n        id\n        title\n        company\n      }\n      sections {\n        id\n        sectionType\n        title\n        position\n        content\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StudyGuideForJob($jobId: ID!, $cursor: String) {\n    job(id: $jobId) {\n      id\n      studyGuideDescriptionFingerprint\n      studyGuides(cursor: $cursor) { guides { id createdAt sourceDescriptionFingerprint outOfDate } nextCursor errors }\n      latestStudyGuideTask { id status errorMessage createdAt studyGuideRetryAfterSeconds }\n    }\n  }\n"): (typeof documents)["\n  query StudyGuideForJob($jobId: ID!, $cursor: String) {\n    job(id: $jobId) {\n      id\n      studyGuideDescriptionFingerprint\n      studyGuides(cursor: $cursor) { guides { id createdAt sourceDescriptionFingerprint outOfDate } nextCursor errors }\n      latestStudyGuideTask { id status errorMessage createdAt studyGuideRetryAfterSeconds }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query StudyGuideContent($jobId: ID!, $guideId: ID!) {\n    job(id: $jobId) {\n      id\n      studyGuide(id: $guideId) { id result createdAt studyGuideOutOfDate }\n    }\n  }\n"): (typeof documents)["\n  query StudyGuideContent($jobId: ID!, $guideId: ID!) {\n    job(id: $jobId) {\n      id\n      studyGuide(id: $guideId) { id result createdAt studyGuideOutOfDate }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation GenerateStudyGuide($jobId: ID!) {\n    generateStudyGuide(input: {jobId: $jobId}) {\n      aiTask { id status errorMessage createdAt studyGuideRetryAfterSeconds }\n      errors\n    }\n  }\n"): (typeof documents)["\n  mutation GenerateStudyGuide($jobId: ID!) {\n    generateStudyGuide(input: {jobId: $jobId}) {\n      aiTask { id status errorMessage createdAt studyGuideRetryAfterSeconds }\n      errors\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;
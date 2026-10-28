# frozen_string_literal: true

# Description: Root mutation fields. Each mutation delegates to a service object.
# Index:
#   - interview prep: generateInterviewQuestionSet, saveInterviewAnswer, regenerateInterviewQuestion,
#     requestInterviewAnswerFeedback, deleteInterviewQuestionSet
#   - jobs: createJob, updateJob, moveJobToStage, deleteJob, scrapeJob, parseJobPosting
#   - profile: updateProfile
#   - experiences: createExperience, updateExperience, deleteExperience, mergeExperiences,
#     moveExperienceHighlight
#   - projects: createProject, updateProject, deleteProject, mergeProjects
#   - educations: createEducation, updateEducation, deleteEducation, mergeEducations
#   - certifications: createCertification, updateCertification, deleteCertification, mergeCertifications
#   - skills: createSkill, updateSkill, deleteSkill, reorderSkills
#   - resume imports: parseResume (file upload), importParsedResume
#   - gap analysis: analyzeJobGaps
#   - resume tailoring: startResumeTailoring, saveTailoredResume,
#     updateResume
#   - gap responses: saveGapResponse
#   - library facts: createLibraryFact, updateLibraryFact, deleteLibraryFact
#   - career library: clearCareerLibrary
module Types
  class MutationType < Types::BaseObject
    field :send_chat_message, mutation: Mutations::Chat::SendMessage
    field :retry_chat_message, mutation: Mutations::Chat::RetryMessage
    field :create_chat_conversation, mutation: Mutations::Chat::CreateConversation
    field :authorize_ai_execution_stream, mutation: Mutations::AuthorizeAiExecutionStream
    field :start_interview, mutation: Mutations::Interviews::StartInterview
    field :begin_interview, mutation: Mutations::Interviews::BeginInterview
    field :abandon_interview, mutation: Mutations::Interviews::AbandonInterview
    field :authorize_interview_recording, mutation: Mutations::Interviews::AuthorizeInterviewRecording
    field :authorize_interview_transcription, mutation: Mutations::Interviews::AuthorizeInterviewTranscription
    field :register_interview_recording, mutation: Mutations::Interviews::RegisterInterviewRecording
    field :start_recorded_transcription, mutation: Mutations::Interviews::StartRecordedTranscription
    field :cancel_recorded_transcription, mutation: Mutations::Interviews::CancelRecordedTranscription
    field :submit_interview_turn, mutation: Mutations::Interviews::SubmitInterviewTurn
    field :skip_interview_question, mutation: Mutations::Interviews::SkipInterviewQuestion
    field :retry_interview_operation, mutation: Mutations::Interviews::RetryInterviewOperation
    field :request_interview_references, mutation: Mutations::Interviews::RequestInterviewReferences
    field :request_interview_clarification, mutation: Mutations::Interviews::RequestInterviewClarification
    field :interview_playback, mutation: Mutations::Interviews::InterviewPlayback

    field :avoid_interview_prompt, mutation: Mutations::Interviews::AvoidInterviewPrompt
    field :avoid_interview_question, mutation: Mutations::InterviewPrep::AvoidInterviewQuestion
    field :generate_interview_question_set, mutation: Mutations::InterviewPrep::GenerateInterviewQuestionSet

    field :save_interview_answer, mutation: Mutations::InterviewPrep::SaveInterviewAnswer

    field :regenerate_interview_question, mutation: Mutations::InterviewPrep::RegenerateInterviewQuestion

    field :request_interview_answer_feedback, mutation: Mutations::InterviewPrep::RequestInterviewAnswerFeedback

    field :delete_interview_question_set, mutation: Mutations::InterviewPrep::DeleteInterviewQuestionSet

    field :update_profile, mutation: Mutations::Users::UpdateProfile

    field :rerank_job_board_listings, mutation: Mutations::JobBoard::RerankJobBoardListings
    field :import_job_board_listing, mutation: Mutations::JobBoard::ImportListing

    field :generate_study_guide, mutation: Mutations::StudyGuides::GenerateStudyGuide

    field :create_job, mutation: Mutations::Jobs::CreateJob
    field :update_job, mutation: Mutations::Jobs::UpdateJob
    field :move_job_to_stage, mutation: Mutations::Jobs::MoveJobToStage
    field :delete_job, mutation: Mutations::Jobs::DeleteJob
    field :scrape_job, mutation: Mutations::Jobs::ScrapeJob
    field :parse_job_posting, mutation: Mutations::Jobs::ParseJobPosting

    field :create_experience, mutation: Mutations::Experiences::CreateExperience
    field :update_experience, mutation: Mutations::Experiences::UpdateExperience
    field :delete_experience, mutation: Mutations::Experiences::DeleteExperience
    field :merge_experiences, mutation: Mutations::Experiences::MergeExperiences
    field :move_experience_highlight, mutation: Mutations::Experiences::MoveExperienceHighlight

    field :create_project, mutation: Mutations::Projects::CreateProject
    field :update_project, mutation: Mutations::Projects::UpdateProject
    field :delete_project, mutation: Mutations::Projects::DeleteProject
    field :merge_projects, mutation: Mutations::Projects::MergeProjects

    field :create_education, mutation: Mutations::Educations::CreateEducation
    field :update_education, mutation: Mutations::Educations::UpdateEducation
    field :delete_education, mutation: Mutations::Educations::DeleteEducation
    field :merge_educations, mutation: Mutations::Educations::MergeEducations

    field :create_certification, mutation: Mutations::Certifications::CreateCertification
    field :update_certification, mutation: Mutations::Certifications::UpdateCertification
    field :delete_certification, mutation: Mutations::Certifications::DeleteCertification
    field :merge_certifications, mutation: Mutations::Certifications::MergeCertifications

    field :create_skill, mutation: Mutations::Skills::CreateSkill
    field :update_skill, mutation: Mutations::Skills::UpdateSkill
    field :delete_skill, mutation: Mutations::Skills::DeleteSkill
    field :reorder_skills, mutation: Mutations::Skills::ReorderSkills

    field :parse_resume, mutation: Mutations::ResumeImports::ParseResume
    field :import_parsed_resume, mutation: Mutations::ResumeImports::ImportParsedResume

    field :analyze_job_gaps, mutation: Mutations::GapAnalysis::AnalyzeJobGaps

    field :start_resume_tailoring, mutation: Mutations::ResumeTailoring::StartResumeTailoring
    field :save_tailored_resume, mutation: Mutations::ResumeTailoring::SaveTailoredResume
    field :update_resume, mutation: Mutations::ResumeTailoring::UpdateResume
    field :delete_resume, mutation: Mutations::ResumeTailoring::DeleteResume

    field :save_gap_response, mutation: Mutations::GapResponses::SaveGapResponse
    field :review_library_section, mutation: Mutations::CareerLibrary::ReviewLibrarySection
    field :answer_library_review, mutation: Mutations::CareerLibrary::AnswerLibraryReview
    field :start_library_edit, mutation: Mutations::CareerLibrary::StartLibraryEdit
    field :accept_library_edit, mutation: Mutations::CareerLibrary::AcceptLibraryEdit
    field :discard_library_edit, mutation: Mutations::CareerLibrary::DiscardLibraryEdit
    field :clear_career_library, mutation: Mutations::CareerLibrary::ClearCareerLibrary

    field :create_library_fact, mutation: Mutations::LibraryFacts::CreateLibraryFact
    field :update_library_fact, mutation: Mutations::LibraryFacts::UpdateLibraryFact
    field :delete_library_fact, mutation: Mutations::LibraryFacts::DeleteLibraryFact
  end
end

# frozen_string_literal: true

# Description: Root mutation fields. Each mutation delegates to a service object.
# Index:
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
#   - resume tailoring: startResumeTailoring, submitTailoredSection, saveTailoredResume,
#     updateResume
#   - gap responses: saveGapResponse
#   - library facts: createLibraryFact, updateLibraryFact, deleteLibraryFact
#   - career library: clearCareerLibrary
module Types
  class MutationType < Types::BaseObject
    field :update_profile, mutation: Mutations::Users::UpdateProfile

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
    field :submit_tailored_section, mutation: Mutations::ResumeTailoring::SubmitTailoredSection
    field :save_tailored_resume, mutation: Mutations::ResumeTailoring::SaveTailoredResume
    field :update_resume, mutation: Mutations::ResumeTailoring::UpdateResume

    field :save_gap_response, mutation: Mutations::GapResponses::SaveGapResponse
    field :clear_career_library, mutation: Mutations::CareerLibrary::ClearCareerLibrary

    field :create_library_fact, mutation: Mutations::LibraryFacts::CreateLibraryFact
    field :update_library_fact, mutation: Mutations::LibraryFacts::UpdateLibraryFact
    field :delete_library_fact, mutation: Mutations::LibraryFacts::DeleteLibraryFact
  end
end

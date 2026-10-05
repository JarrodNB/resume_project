# frozen_string_literal: true

# Description: Root mutation fields. Each mutation delegates to a service object.
# Index:
#   - jobs: createJob, updateJob, moveJobToStage, deleteJob, scrapeJob
#   - experiences: createExperience, updateExperience, deleteExperience, mergeExperiences,
#     moveExperienceHighlight
#   - projects: deleteProject, mergeProjects
#   - educations: deleteEducation, mergeEducations
#   - skills: deleteSkill, reorderSkills
#   - resume imports: parseResume (file upload), importParsedResume
#   - gap analysis: analyzeJobGaps
#   - resume tailoring: startResumeTailoring, submitTailoredSection, saveTailoredResume
#   - gap responses: saveGapResponse
#   - library facts: deleteLibraryFact
module Types
  class MutationType < Types::BaseObject
    field :create_job, mutation: Mutations::Jobs::CreateJob
    field :update_job, mutation: Mutations::Jobs::UpdateJob
    field :move_job_to_stage, mutation: Mutations::Jobs::MoveJobToStage
    field :delete_job, mutation: Mutations::Jobs::DeleteJob
    field :scrape_job, mutation: Mutations::Jobs::ScrapeJob

    field :create_experience, mutation: Mutations::Experiences::CreateExperience
    field :update_experience, mutation: Mutations::Experiences::UpdateExperience
    field :delete_experience, mutation: Mutations::Experiences::DeleteExperience
    field :merge_experiences, mutation: Mutations::Experiences::MergeExperiences
    field :move_experience_highlight, mutation: Mutations::Experiences::MoveExperienceHighlight

    field :delete_project, mutation: Mutations::Projects::DeleteProject
    field :merge_projects, mutation: Mutations::Projects::MergeProjects

    field :delete_education, mutation: Mutations::Educations::DeleteEducation
    field :merge_educations, mutation: Mutations::Educations::MergeEducations

    field :delete_skill, mutation: Mutations::Skills::DeleteSkill
    field :reorder_skills, mutation: Mutations::Skills::ReorderSkills

    field :parse_resume, mutation: Mutations::ResumeImports::ParseResume
    field :import_parsed_resume, mutation: Mutations::ResumeImports::ImportParsedResume

    field :analyze_job_gaps, mutation: Mutations::GapAnalysis::AnalyzeJobGaps

    field :start_resume_tailoring, mutation: Mutations::ResumeTailoring::StartResumeTailoring
    field :submit_tailored_section, mutation: Mutations::ResumeTailoring::SubmitTailoredSection
    field :save_tailored_resume, mutation: Mutations::ResumeTailoring::SaveTailoredResume

    field :save_gap_response, mutation: Mutations::GapResponses::SaveGapResponse
    field :delete_library_fact, mutation: Mutations::LibraryFacts::DeleteLibraryFact
  end
end

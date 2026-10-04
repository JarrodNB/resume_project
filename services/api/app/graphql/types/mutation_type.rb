# frozen_string_literal: true

# Description: Root mutation fields. Each mutation delegates to a service object.
# Index:
#   - jobs: createJob, updateJob, moveJobToStage, deleteJob
#   - experiences: createExperience, updateExperience, deleteExperience, mergeExperiences
#   - projects: deleteProject, mergeProjects
#   - educations: deleteEducation, mergeEducations
#   - skills: deleteSkill
#   - resume imports: parseResume (file upload), importParsedResume
module Types
  class MutationType < Types::BaseObject
    field :create_job, mutation: Mutations::Jobs::CreateJob
    field :update_job, mutation: Mutations::Jobs::UpdateJob
    field :move_job_to_stage, mutation: Mutations::Jobs::MoveJobToStage
    field :delete_job, mutation: Mutations::Jobs::DeleteJob

    field :create_experience, mutation: Mutations::Experiences::CreateExperience
    field :update_experience, mutation: Mutations::Experiences::UpdateExperience
    field :delete_experience, mutation: Mutations::Experiences::DeleteExperience
    field :merge_experiences, mutation: Mutations::Experiences::MergeExperiences

    field :delete_project, mutation: Mutations::Projects::DeleteProject
    field :merge_projects, mutation: Mutations::Projects::MergeProjects

    field :delete_education, mutation: Mutations::Educations::DeleteEducation
    field :merge_educations, mutation: Mutations::Educations::MergeEducations

    field :delete_skill, mutation: Mutations::Skills::DeleteSkill

    field :parse_resume, mutation: Mutations::ResumeImports::ParseResume
    field :import_parsed_resume, mutation: Mutations::ResumeImports::ImportParsedResume
  end
end

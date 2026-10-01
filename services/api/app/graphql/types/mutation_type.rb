# frozen_string_literal: true

# Description: Root mutation fields. Each mutation delegates to a service object.
# Index:
#   - jobs: createJob, updateJob, moveJobToStage, deleteJob
#   - experiences: createExperience, updateExperience, deleteExperience
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

    field :parse_resume, mutation: Mutations::ResumeImports::ParseResume
    field :import_parsed_resume, mutation: Mutations::ResumeImports::ImportParsedResume
  end
end

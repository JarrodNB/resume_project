# Queues a guide for an owned job. Live task updates report generation progress.
module Mutations
  module StudyGuides
    class GenerateStudyGuide < Mutations::BaseMutation
      argument :job_id, ID, required: true
      field :ai_task, Types::AiTaskType

      def resolve(job_id:)
        job = current_user.jobs.find(job_id)
        payload_from(::StudyGuides::StartGuideService.call(user: current_user, job: job), :ai_task)
      end
    end
  end
end

# frozen_string_literal: true

# Description: Starts scraping a job posting URL into a new Job. Follow progress with the
# aiTaskUpdated subscription; once completed, the task's `job` is the saved Job.
module Mutations
  module Jobs
    class ScrapeJob < Mutations::BaseMutation
      argument :url, String, required: true, description: "A LinkedIn job link (linkedin.com/jobs/view/...)."

      field :ai_task, Types::AiTaskType

      # Calls Jobs::StartJobScrapingService.
      def resolve(url:)
        payload_from(::Jobs::StartJobScrapingService.call(user: current_user, url: url), :ai_task)
      end
    end
  end
end

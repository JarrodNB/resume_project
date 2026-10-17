# Report subscriptions cover scheduling before an AI task exists as well as completed checks.
module Subscriptions
  class AtsReportUpdated < BaseSubscription
    argument :resume_id, ID, required: true
    type Types::AtsReportType, null: true

    def subscribe(resume_id:)
      resume = current_user.resumes.find(resume_id)
      AtsChecks::ReadReportService.call(resume: resume).value
    end

    def update(resume_id:)
      resume = current_user.resumes.find(resume_id)
      AtsChecks::ReadReportService.call(resume: resume).value
    end
  end
end

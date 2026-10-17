# Deliver report updates only after persistence, including scheduling before a task exists.
module AtsChecks
  class NotifyReportService < ApplicationService
    def initialize(resume:)
      @resume = resume
    end

    def call
      ActiveRecord.after_all_transactions_commit do
        begin
          ApiSchema.subscriptions.trigger(:ats_report_updated, { resume_id: @resume.id }, @resume)
        rescue StandardError => error
          Rails.logger.error("ATS report notification failed: #{error.class}")
        end
      end
      success(@resume)
    end
  end
end

# Recover cleanup even when the process exits before its delayed cleanup job is scheduled.
namespace :ats_checks do
  desc "Purge completed and expired temporary PDF exports"
  task cleanup_pdfs: :environment do
    AiTask.where(task_type: "check_resume_pdf").where("created_at < ? OR status IN (?)", 24.hours.ago, %w[completed failed]).find_each do |task|
      AtsChecks::CleanupPdfCheckJob.perform_now(task.id) if task.source_file.attached?
    end
  end
end

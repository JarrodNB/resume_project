# Recovery for a process failure between saved snapshot creation and background dispatch.
namespace :ats_checks do
  desc "Requeue pending content checks using their existing durable run/task identity"
  task recover_pending: :environment do
    AtsCheckRun.where(status: "pending").find_each do |run|
      AtsChecks::DispatchContentCheckJob.perform_later(run.id)
    end
  end
end

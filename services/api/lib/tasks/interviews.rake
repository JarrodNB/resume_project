# Adopt saved work before the HTTP runtime starts; never invoke providers or nudges.
namespace :interviews do
  desc "Attach existing pending/running interview work to durable delivery once"
  task adopt_delivery: :environment do
    result = Interviews::BackfillDeliveryService.call
    abort "Interview delivery adoption failed" unless result.success?

    counts = result.value
    puts "Interview delivery adopted: #{counts.fetch(:dispatched)} pending, #{counts.fetch(:watchdogs)} watchdogs, #{counts.fetch(:expired)} expired"
  end
end

# Native/Compose/production startup already runs db:prepare. Adoption runs after
# migrations and stays idempotent on later starts; it is not a recurring task.
Rake::Task["db:prepare"].enhance { Rake::Task["interviews:adopt_delivery"].invoke }

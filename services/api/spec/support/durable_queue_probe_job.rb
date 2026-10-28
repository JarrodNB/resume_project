# A provider-free job used to prove persistence and execution across Rails processes.
class DurableQueueProbeJob < ApplicationJob
  self.queue_adapter = :solid_queue
  self.enqueue_after_transaction_commit = false
  queue_as "durability_probes"

  def perform(user_id)
    User.find(user_id).update!(summary: "Durable queue execution completed")
  end
end

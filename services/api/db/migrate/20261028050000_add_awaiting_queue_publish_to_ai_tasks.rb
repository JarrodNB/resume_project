# Marks queue-published tasks that are saved but not yet sent to SQS, so a crash between the two
# steps can be repaired by a sweep. Tasks that never use SQS (interview HTTP work) stay false.
class AddAwaitingQueuePublishToAiTasks < ActiveRecord::Migration[8.1]
  def change
    add_column :ai_tasks, :awaiting_queue_publish, :boolean, null: false, default: false
    add_index :ai_tasks, :created_at, where: "awaiting_queue_publish", name: "index_ai_tasks_awaiting_queue_publish"
  end
end

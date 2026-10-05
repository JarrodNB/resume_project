# Description: A tailor_resume task is requeued once per section. `generation` is the step
# Rails is waiting on; `usage_generation` is the step whose token cost has already been added,
# so a redelivered result cannot rewind the draft or bill the same step twice.
class AddGenerationToAiTasks < ActiveRecord::Migration[8.1]
  def change
    change_table :ai_tasks, bulk: true do |t|
      t.integer :generation, null: false, default: 0
      t.integer :usage_generation, null: false, default: -1
    end
  end
end

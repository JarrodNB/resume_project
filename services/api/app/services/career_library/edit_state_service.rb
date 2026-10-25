# Finds the latest owned edit for one target; discarded drafts stay in history only.
module CareerLibrary
  class EditStateService < ApplicationService
    def initialize(user:, kind:, record_id:)
      @user, @kind, @record_id = user, kind, record_id
    end

    def call
      EditSnapshot.capture(user: @user, kind: @kind, record_id: @record_id)
      task = EditSnapshot.latest(user: @user, kind: @kind, record_id: @record_id)
      task = nil if task && EditSnapshot.discarded?(task)
      success({ ai_task: task, stale: task ? EditSnapshot.stale?(user: @user, task: task) : false })
    end
  end
end

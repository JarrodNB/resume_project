# Finds the latest owned edit for one target; discarded drafts stay in history only.
module CareerLibrary
  class EditStateService < ApplicationService
    def initialize(user:, kind:, record_id:)
      @user, @kind, @record_id = user, kind, record_id
    end

    def call
      EditCommand.capture(user: @user, kind: @kind, record_id: @record_id)
      task = EditCommand.latest(user: @user, kind: @kind, record_id: @record_id)
      task = nil if task && EditCommand.discarded?(task)
      success({ ai_task: task, stale: task ? EditCommand.stale?(user: @user, task: task) : false })
    end
  end
end

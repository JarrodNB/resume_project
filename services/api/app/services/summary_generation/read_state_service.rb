# Restores the latest owned task and its freshness after reload without starting work.
module SummaryGeneration
  class ReadStateService < ApplicationService
    def initialize(user:, target_kind:, target_id: nil)
      @user, @kind, @id = user, target_kind, target_id
    end

    def call
      raise ActiveRecord::RecordNotFound unless @kind == "profile" && (@id.nil? || @id.to_s == @user.id.to_s)
      task = Snapshot.latest(user: @user, target_kind: @kind, target_id: @user.id)
      success({ ai_task: task, stale: !!task && !task.accepted? && Snapshot.stale?(user: @user, task: task) })
    rescue ActiveRecord::RecordNotFound
      failure([ "Record not found" ])
    end
  end
end

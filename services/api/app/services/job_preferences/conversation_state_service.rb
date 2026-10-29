# Project safe accepted dialogue from owned immutable tasks, keeping model history private.
module JobPreferences
  class ConversationStateService < ApplicationService
    def initialize(user:)
      @user = user
    end

    def call
      task = @user.ai_tasks.elicit_job_preferences.order(created_at: :desc, id: :desc).first
      turns, current = [], task
      StartConversationService::MAX_TURNS.times do
        break unless current
        if current.completed? || current.needs_user_input?
          reply = current.completed? ? current.result&.fetch("reply", nil) : current.pending_questions.first&.fetch("question", nil)
          turns.unshift({user_message: current.input["message"], assistant_message: reply.to_s})
        end
        previous_id = current.input["previous_task_id"]
        current = previous_id.present? ? @user.ai_tasks.elicit_job_preferences.find_by(id: previous_id) : nil
      end
      version = @user.reload.job_preference_profile&.version || 0
      expected = task&.result&.fetch("profile_version", nil) || task&.input&.fetch("profile_version", nil)
      success({ai_task: task, turns: turns, stale: task.present? && expected != version})
    end
  end
end

# Admits integrated interview sessions without changing existing saved execution modes.
# Rails probes safe executor readiness and never contacts providers or reads AI keys.
module Interviews
  class StartSessionService < ApplicationService
    def initialize(user:, execution_mode: "real", career_focus: nil, setup: nil, job: nil, conversation_mode: "turn_based")
      @user, @execution_mode, @career_focus, @conversation_mode = user, execution_mode, career_focus, conversation_mode
      @setup = setup
      @job = job
    end

    def call
      return failure("Scripted interviews are retired. Start a real spoken interview.") unless @execution_mode == "real"

      if !RuntimeReadiness.ready?
        return failure("Real interview unavailable. Check the real runtime readiness and required provider configuration.")
      end
      StartPreparationService.call(user: @user, career_focus: @career_focus, setup: @setup, job: @job, conversation_mode: @conversation_mode)
    end
  end
end

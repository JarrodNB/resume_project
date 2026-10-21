# Admits real development sessions without changing existing saved modes.
# Rails probes safe executor readiness and never contacts providers or reads AI keys.
module Interviews
  class StartDemoService < ApplicationService
    def initialize(user:, execution_mode: "real")
      @user, @execution_mode = user, execution_mode
    end

    def call
      return failure("Scripted interviews are retired. Start a real spoken interview.") unless @execution_mode == "real"

      if !DemoAccess.real_enabled?
        return failure("Real interview unavailable. Enable the dedicated real runtime and admission in development.")
      end
      if !RealRuntimeReadiness.ready?
        return failure("Real interview unavailable. Check the real runtime readiness and required provider configuration.")
      end
      CreateFixtureService.call(user: @user, execution_mode: @execution_mode)
    end
  end
end

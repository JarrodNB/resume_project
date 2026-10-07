# Description: Records the user's decision on the open section and requeues the same tailor
# task at the next generation. An approved section whose strings exceed the screen cap is
# rejected here. Omit and reopen do not store screened text.
# Screening happens in the worker; a blocked edit comes back as needs_user_input and this
# service is not what rejects that.
# Index:
#   - ACTIONS: approve, omit, write_anyway, reopen
#   - call: updates the task input and publishes it again
module ResumeTailoring
  class SubmitTailoredSectionService < ApplicationService
    ACTIONS = %w[approve omit write_anyway reopen].freeze
    NOT_WAITING_MESSAGE = "This resume isn't waiting for an edit.".freeze
    UNKNOWN_ACTION_MESSAGE = "Choose whether to use this section, leave it out, or write it anyway.".freeze

    def initialize(ai_task:, section_type:, action:, content: {})
      @ai_task = ai_task
      @section_type = section_type
      @action = action
      @content = content.is_a?(Hash) ? content : {}
    end

    # Increments the generation under a row lock so two submits can't both requeue.
    def call
      return failure([ NOT_WAITING_MESSAGE ]) unless waiting?
      return failure([ UNKNOWN_ACTION_MESSAGE ]) unless ACTIONS.include?(@action)
      return failure([ "That isn't a section of this resume." ]) unless known_section?
      return failure([ TextLimits::SECTION_TOO_LONG ]) if @action == "approve" && TextLimits.section_too_long?(@content)

      published = false
      @ai_task.with_lock do
        return failure([ NOT_WAITING_MESSAGE ]) unless @ai_task.needs_user_input?

        input = @ai_task.input.deep_dup
        input["pending_section"] = {
          "section_type" => @section_type,
          "action" => @action,
          "content" => @content
        }
        input["generation"] = @ai_task.generation + 1
        @ai_task.update!(input: input, generation: input["generation"])
        published = true
      end
      return failure([ NOT_WAITING_MESSAGE ]) unless published

      AiTasks::RepublishAiTaskService.call(ai_task: @ai_task)
    end

    private

    # True for a tailor task paused for the user and not yet saved.
    def waiting?
      @ai_task.tailor_resume? && @ai_task.needs_user_input? && !@ai_task.accepted?
    end

    # True for a section the tailoring loop writes.
    def known_section?
      %w[contact summary experience projects education skills].include?(@section_type)
    end
  end
end

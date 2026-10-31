# Starts one section review, reusing an active request. Source selection and admission
# share the existing owner lock; no model work happens in the web request.
module CareerLibrary
  class StartReviewService < ApplicationService
    def initialize(user:, section:)
      @user, @section = user, section
    end

    def call
      return failure([ "Choose a supported library section" ]) unless ReviewSnapshot::SECTIONS.include?(@section)

      AiTasks::EnqueueAiTaskService.call(
        user: @user, task_type: "review_library_section",
        resolve_existing: -> {
          running = @user.ai_tasks.review_library_section.queued.where("input ->> 'section' = ?", @section)
            .where(created_at: AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW.ago..).order(created_at: :desc).first
          success(running) if running
        },
        prepare_task: ->(task) {
          snapshot = ReviewSnapshot.build(user: @user, section: @section)
          if snapshot["targets"].empty?
            failure([ "Add narrative details before reviewing this section." ])
          elsif snapshot["targets"].length > ReviewSnapshot::MAX_TARGETS || snapshot.to_json.bytesize > ReviewSnapshot::MAX_SOURCE_BYTES
            failure([ "This section is too large to review. Shorten it and try again." ])
          else
            task.input = ReviewCommand.from_projection(snapshot)
            success(task)
          end
        }
      )
    end
  end
end

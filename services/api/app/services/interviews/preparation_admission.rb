# Finds the hourly admission an interview's child AI tasks share: the session's preparation task.
# Prompt help, session feedback and the live conversation bill attach their tasks to it, so one
# interview counts once toward the hourly limit. A session without a preparation (an offline
# fixture) has none. A preparation task that is not this session's own root, or a child task
# linked to another root, is refused, so a broken link fails closed instead of skipping admission.
module Interviews
  module PreparationAdmission
    # @param task [AiTask, nil] an existing child task whose link to the root is checked too
    # @return [ServiceResult<AiTask, nil>] the root task, nil for a session without preparation
    def self.call(interview, task: nil)
      preparation = interview.operations.preparation.first
      root = preparation&.ai_task
      if preparation || task&.hourly_admission_task_id
        valid = root && root.user_id == interview.user_id && root.subject == interview && root.interview_preparation? &&
          root.hourly_admission_task_id.nil? && root.input["operation_id"] == preparation.id
        valid &&= task.hourly_admission_task_id == root.id if task
        return ServiceResult.new(success: false, value: nil, errors: [ "Interview admission is invalid" ]) unless valid
      end
      ServiceResult.new(success: true, value: root, errors: [])
    end
  end
end

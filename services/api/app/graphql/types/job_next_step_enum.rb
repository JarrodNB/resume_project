# frozen_string_literal: true

# Description: The single suggested next step for a saved job on the Home pipeline
# (mirrors Jobs::BuildPipelineService::NEXT_STEPS).
module Types
  class JobNextStepEnum < Types::BaseEnum
    description "The one thing to do next for a saved job."

    value "COMPARISON_RUNNING", "The job is being compared with the career library.", value: "comparison_running"
    value "RESUME_RUNNING", "A tailored resume is being written.", value: "resume_running"
    value "COMPARISON_FAILED", "The latest comparison failed; try it again.", value: "comparison_failed"
    value "RESUME_FAILED", "The latest resume draft failed; try it again.", value: "resume_failed"
    value "REVIEW_RESUME_DRAFT", "A resume draft is ready but not saved yet.", value: "review_resume_draft"
    value "COMPARE", "Compare the job with the career library.", value: "compare"
    value "WRITE_RESUME", "Write a tailored resume for the job.", value: "write_resume"
    value "READY_TO_APPLY", "A resume is saved; apply to the job.", value: "ready_to_apply"
    value "AWAITING_RESPONSE", "Applied; waiting to hear back.", value: "awaiting_response"
    value "PRACTICE_INTERVIEW", "Interviewing; practice for it.", value: "practice_interview"
    value "NONE", "Nothing left to do (offer or rejection).", value: "none"
  end
end

# Candidate choices for a new prepared interview; Rails validates supported values.
module Types
  class InterviewSetupInput < Types::BaseInputObject
    argument :question_count, Integer, required: false, default_value: 8
    argument :question_format, String, required: false, default_value: "mixed"
  end
end

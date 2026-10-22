# Safe frozen candidate choices, without private career sources or execution configuration.
module Types
  class InterviewSetupType < Types::BaseObject
    field :question_count, Integer, null: false
    field :question_format, String, null: false
    field :difficulty, String, null: false
    field :interviewer, String, null: false
    field :focus_areas, [ String ], null: false
  end
end

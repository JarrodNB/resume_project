# Description: Validated interview practice scopes, shared with persisted model values.
# Index:
#   - InterviewQuestionSetTypeEnum: five scopes for written practice
module Types
  class InterviewQuestionSetTypeEnum < Types::BaseEnum
    extend EnumFromValues
    values_from InterviewQuestionSet::SET_TYPES
  end
end

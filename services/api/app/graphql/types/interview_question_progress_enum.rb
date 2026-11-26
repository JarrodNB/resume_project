# frozen_string_literal: true

# Description: Where a practice question sits on its answer → feedback line (see InterviewPrep::ActiveAnswer.progress).
module Types
  class InterviewQuestionProgressEnum < Types::BaseEnum
    extend EnumFromValues
    values_from %w[unanswered answered reviewing reviewed outdated]
  end
end

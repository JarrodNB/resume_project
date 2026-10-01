# frozen_string_literal: true

# Description: Base or tailored resume (mirrors Resume::KINDS).
module Types
  class ResumeKindEnum < Types::BaseEnum
    extend EnumFromValues
    values_from Resume::KINDS
  end
end

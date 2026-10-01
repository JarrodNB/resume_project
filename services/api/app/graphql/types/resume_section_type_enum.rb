# frozen_string_literal: true

# Description: Kind of resume section (mirrors ResumeSection::SECTION_TYPES).
module Types
  class ResumeSectionTypeEnum < Types::BaseEnum
    extend EnumFromValues
    values_from ResumeSection::SECTION_TYPES
  end
end

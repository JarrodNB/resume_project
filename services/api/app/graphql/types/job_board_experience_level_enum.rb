# Provider experience levels are explicit search preferences, not inferred user attributes.
module Types
  class JobBoardExperienceLevelEnum < Types::BaseEnum
    graphql_name "JobBoardExperienceLevel"
    description "Experience levels accepted by the job provider."
    JobBoard::ExperienceLevels::VALUES.each { |level| value level }
  end
end

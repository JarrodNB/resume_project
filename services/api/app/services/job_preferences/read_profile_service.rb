# Read the owner's current profile without creating a record just by opening Find jobs.
module JobPreferences
  class ReadProfileService < ApplicationService
    def initialize(user:)
      @user = user
    end

    def call
      success(@user.reload.job_preference_profile || { version: 0, confirmed_revision: 0, draft_criteria: [], confirmed_criteria: [] })
    end
  end
end

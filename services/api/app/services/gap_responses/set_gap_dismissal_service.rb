# Description: Dismisses one requirement of a job, or restores it. Running it twice changes nothing.
# A requirement with a saved answer can't be dismissed, so an answer the resume writer can use is
# never hidden on the Fit tab. Returns the job.
# Index:
#   - call: adds or removes the dismissal and returns the job
module GapResponses
  class SetGapDismissalService < ApplicationService
    def initialize(job:, requirement:, dismissed:)
      @job = job
      @requirement = requirement.to_s
      @dismissed = dismissed
    end

    # Adds or removes the dismissal under the same owner lock as saving an answer.
    def call
      return failure([ "Requirement can't be blank" ]) if @requirement.blank?

      @job.user.with_lock do
        @dismissed ? dismiss : restore
      end
    end

    private

    # Records the dismissal unless the requirement already has an answer.
    def dismiss
      if @job.gap_responses.exists?(requirement: @requirement)
        return failure([ "Clear your details for this requirement before dismissing it" ])
      end

      dismissal = @job.gap_dismissals.find_or_initialize_by(requirement: @requirement)
      return failure(dismissal.errors) unless dismissal.save

      success(@job)
    end

    # Removes the dismissal if there is one.
    def restore
      @job.gap_dismissals.where(requirement: @requirement).destroy_all
      success(@job)
    end
  end
end

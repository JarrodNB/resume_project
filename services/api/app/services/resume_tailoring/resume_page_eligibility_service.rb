# Checks whether the owner's library has enough narrative to offer a two-page target.
# Identity, headings, dates, contact and bare skill fields never contribute to the gate.
module ResumeTailoring
  class ResumePageEligibilityService < ApplicationService
    MINIMUM_WORDS = 700

    def initialize(user:)
      @user = user
    end

    def call
      narratives = [ @user.summary ]
      narratives.concat(@user.experiences.pluck(:description))
      narratives.concat(ExperienceHighlight.joins(:experience).where(experiences: { user_id: @user.id }).pluck(:content))
      narratives.concat(@user.projects.pluck(:description))
      narratives.concat(@user.educations.pluck(:description))
      narratives.concat(@user.certifications.pluck(:description))
      narratives.concat(@user.library_facts.pluck(:response))
      words = narratives.sum { |text| text.to_s.scan(/[[:alpha:]]+(?:['’-][[:alpha:]]+)*/).size }
      success(words >= MINIMUM_WORDS)
    end
  end
end

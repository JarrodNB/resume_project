# frozen_string_literal: true

# Description: The signed-in user.
# Index:
#   - id, email (sign-in), name
#   - billing: plan and dates from Billing::ResolvePlanService
#   - live_interview_refusal: why a live interview can't start now (Interviews::LiveAllowance)
#   - profile: contact_email, phone, location, links, summary; derived job search suggestions
module Types
  class UserType < Types::BaseObject
    field :id, ID, null: false
    field :email, String, null: false
    field :name, String
    field :contact_email, String, description: "Email shown on resumes (may differ from the sign-in email)."
    field :phone, String
    field :location, String
    field :links, [ Types::ProfileLinkType ], null: false
    field :job_title_suggestions, [ String ], null: false
    field :summary, String
    field :include_summary, Boolean, null: false
    field :resume_section_order, [ Types::ResumeSectionTypeEnum ], null: false, method: :ordered_resume_section_types,
          description: "Default section order for new resumes. Contact is always first and is not listed."

    field :billing, Types::BillingType, null: false, description: "Plan and dates only; never limits or spend."

    field :live_interview_refusal, String, null: true,
          description: "Why a new live interview can't start now (the live limit is reached), or null when it can. Never an amount."

    def billing = Billing::ResolvePlanService.call(user: object).value

    def live_interview_refusal = Interviews::LiveAllowance.start_refusal(object)

    # Returns structured links while keeping legacy string rows readable.
    def links
      object.links.filter_map do |link|
        normalized = link.respond_to?(:to_h) ? link.to_h.stringify_keys : { "label" => link.to_s, "url" => link.to_s }
        normalized if normalized["label"].present? && normalized["url"].present?
      end
    end
  end
end

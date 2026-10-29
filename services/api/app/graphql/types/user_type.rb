# frozen_string_literal: true

# Description: The signed-in user.
# Index:
#   - id, email (sign-in), name
#   - profile: contact_email, phone, location, links, summary; derived job search suggestions
#   - ai_usage: this month's estimated AI spend and budget
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
    field :ai_usage, Types::AiUsageType, null: false

    # Returns structured links while keeping legacy string rows readable.
    def links
      object.links.filter_map do |link|
        normalized = link.respond_to?(:to_h) ? link.to_h.stringify_keys : { "label" => link.to_s, "url" => link.to_s }
        normalized if normalized["label"].present? && normalized["url"].present?
      end
    end
    # Summarizes the user's AI spend this month. Only reachable through `me`, so it's always the
    # signed-in user.
    def ai_usage = AiUsage::SummarizeMonthlyAiUsageService.call(user: object).value
  end
end

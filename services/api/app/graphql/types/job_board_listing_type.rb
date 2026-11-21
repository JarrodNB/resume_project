# Displays selected shared provider fields as plain text, with only the signed-in
# owner's saved Job link. Raw provider JSON and markup never leave this type.
module Types
  class JobBoardListingType < Types::BaseObject
    field :id, ID, null: false
    field :title, String, null: false
    field :company, String
    field :location, String
    field :description, String, null: false
    field :application_url, String
    field :remote_type, String
    field :has_remote, Boolean
    field :employment_type, String
    field :salary_text, String
    field :salary_currency, String
    field :published, String
    field :is_active, Boolean
    field :saved_job, Types::JobType

    def title = object.payload.fetch("title")
    def company = object.payload.dig("company", "name")
    def location = object.payload["location"]
    def description = JobBoard::ListingDescription.new(object.payload["description"].to_s).text
    def application_url = object.payload["application_url"]
    def remote_type = object.payload["remote_type"]
    def has_remote = object.payload["has_remote"]
    def employment_type = object.payload["employment_type"]
    def salary_text = object.payload["salary_text"]
    def salary_currency = object.payload["salary_currency"]
    def published = object.payload["published"]
    def is_active = object.payload["is_active"]

    def saved_job
      context[:job_board_saved_jobs] ||= JobBoard::SavedJobLookup.new(user: context[:current_user])
      context[:job_board_saved_jobs].find(object)
    end
  end
end

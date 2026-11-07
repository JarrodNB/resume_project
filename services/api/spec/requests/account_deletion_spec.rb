# Checks self-service account deletion through the real cookie session, CSRF and Devise boundaries.
require "rails_helper"

RSpec.describe "Account deletion", type: :request do
  include ActiveJob::TestHelper
  let(:password) { "a quiet orchard after rain" }
  let(:headers) { { "ACCEPT" => "application/json", "HTTP_ORIGIN" => "http://localhost:5173" } }

  around do |example|
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    example.run
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  def sign_in_browser(browser, user)
    browser.get "/auth/session", headers: headers
    browser.post "/auth/sign_in", params: { user: { email: user.email, password: password } }, as: :json,
      headers: headers.merge("X-CSRF-Token" => browser.response.parsed_body.fetch("csrfToken"))
    expect(browser.response).to have_http_status(:ok)
    browser.response.parsed_body.fetch("csrfToken")
  end

  def delete_account(browser, csrf, current_password)
    browser.delete "/auth/account", params: { user: { current_password: current_password } }, as: :json,
      headers: headers.merge("X-CSRF-Token" => csrf)
  end

  it "keeps the account when the password is wrong" do
    user = create(:user)
    csrf = sign_in_browser(self, user)
    delete_account(self, csrf, "not my password at all")
    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to eq([ "Current password is incorrect" ])
    expect(User.exists?(user.id)).to be(true)
  end

  it "rejects a request without the CSRF token" do
    user = create(:user)
    sign_in_browser(self, user)
    delete_account(self, "forged", password)
    expect(response).to have_http_status(:unprocessable_content)
    expect(User.exists?(user.id)).to be(true)
  end

  it "requires a signed-in session" do
    get "/auth/session", headers: headers
    delete_account(self, response.parsed_body.fetch("csrfToken"), password)
    expect(response).to have_http_status(:unauthorized)
  end

  it "deletes the account and its data, signs out every browser, and leaves other accounts alone" do
    user = create(:user)
    other = create(:user)
    experience = create(:experience, user: user)
    create(:experience_highlight, experience: experience)
    job = create(:job, user: user)
    other_job = create(:job, user: other)
    create(:resume, user: user, job: job)
    create(:chat_conversation, user: user)
    second_browser = ActionDispatch::Integration::Session.new(Rails.application)
    sign_in_browser(second_browser, user)
    csrf = sign_in_browser(self, user)

    delete_account(self, csrf, password)

    expect(response).to have_http_status(:ok)
    expect(User.exists?(user.id)).to be(false)
    expect(Experience.where(user_id: user.id)).to be_empty
    expect(ExperienceHighlight.where(experience_id: experience.id)).to be_empty
    expect(Job.where(user_id: user.id)).to be_empty
    expect(Resume.where(user_id: user.id)).to be_empty
    expect(ChatConversation.where(user_id: user.id)).to be_empty
    expect(Job.exists?(other_job.id)).to be(true)
    [ self, second_browser ].each do |browser|
      browser.get "/auth/session", headers: headers
      expect(browser.response.parsed_body["user"]).to be_nil
    end
  end

  it "purges the account's uploaded resume files" do
    user = create(:user)
    task = create(:ai_task, :completed_resume_parse, user: user)
    task.source_file.attach(io: StringIO.new("%PDF-1.4"), filename: "resume.pdf", content_type: "application/pdf")
    blob_id = task.source_file.blob.id
    csrf = sign_in_browser(self, user)

    perform_enqueued_jobs { delete_account(self, csrf, password) }

    expect(response).to have_http_status(:ok)
    expect(ActiveStorage::Blob.exists?(blob_id)).to be(false)
  end
end

# Checks account isolation through cookie-authenticated HTTP, including real multipart
# upload ownership. External AI dispatch is replaced; authentication and domain lookup are real.
require "rails_helper"

RSpec.describe "Account ownership over HTTP", type: :request do
  let(:headers) { { "ACCEPT" => "application/json", "HTTP_ORIGIN" => "http://localhost:5173" } }

  around do |example|
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    example.run
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  def login(user)
    get "/auth/session", headers: headers
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } },
      as: :json, headers: headers.merge("X-CSRF-Token" => response.parsed_body.fetch("csrfToken"))
    expect(response).to have_http_status(:ok)
    @csrf = response.parsed_body.fetch("csrfToken")
  end

  def graphql(query, variables = {})
    post "/graphql", params: { query: query, variables: variables }, as: :json,
      headers: headers.merge("X-CSRF-Token" => @csrf)
    expect(response).to have_http_status(:ok)
    response.parsed_body
  end

  it "changes account identity after logout without exposing the previous account's reads or writes" do
    first, second = create_list(:user, 2)
    first_job = create(:job, user: first, title: "First account private role")
    second_job = create(:job, user: second, title: "Second account role")
    login(first)
    expect(graphql("{ jobs { id } }").dig("data", "jobs")).to eq([ { "id" => first_job.id } ])
    delete "/auth/sign_out", headers: headers.merge("X-CSRF-Token" => @csrf)
    expect(response).to have_http_status(:ok)
    login(second)
    expect(graphql("{ jobs { id } }").dig("data", "jobs")).to eq([ { "id" => second_job.id } ])
    result = graphql("query($id: ID!) { job(id: $id) { title } }", { id: first_job.id })
    expect(result.fetch("errors").first.fetch("message")).to eq("Record not found")
    result = graphql("mutation($id: ID!) { updateJob(input: {id: $id, attributes: {title: \"Changed\"}}) { job { id } errors } }", { id: first_job.id })
    expect(result.fetch("errors").first.fetch("message")).to eq("Record not found")
    expect(first_job.reload.title).to eq("First account private role")
  end

  it "binds multipart upload tasks to the cookie owner and hides them from another account" do
    first, second = create_list(:user, 2)
    queue = instance_double(Shoryuken::Queue, send_message: nil)
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    login(first)
    post "/graphql", params: {
      operations: { query: "mutation($file: Upload!) { parseResume(input: {file: $file}) { aiTask { id } errors } }", variables: { file: nil } }.to_json,
      map: { "0" => [ "variables.file" ] }.to_json,
      "0" => Rack::Test::UploadedFile.new(StringIO.new(minimal_pdf_bytes), "application/pdf", original_filename: "resume.pdf")
    }, headers: headers.merge("X-CSRF-Token" => @csrf)
    expect(response).to have_http_status(:ok)
    task_id = response.parsed_body.dig("data", "parseResume", "aiTask", "id")
    expect(first.ai_tasks.find(task_id).source_file).to be_attached
    expect(second.ai_tasks).to be_empty
    delete "/auth/sign_out", headers: headers.merge("X-CSRF-Token" => @csrf)
    login(second)
    result = graphql("query($id: ID!) { aiTask(id: $id) { id } }", { id: task_id })
    expect(result.fetch("errors").first.fetch("message")).to eq("Record not found")
  end
end

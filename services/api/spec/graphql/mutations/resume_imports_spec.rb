# Description: parseResume (file upload) and importParsedResume mutations, including ownership.
require "rails_helper"

RSpec.describe "Resume import mutations" do
  let(:user) { create(:user) }

  it "parseResume stores the upload and returns the queued task" do
    queue = instance_double(Shoryuken::Queue, send_message: nil)
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    upload = ApolloUploadServer::Wrappers::UploadedFile.new(
      build_uploaded_file(content: minimal_pdf_bytes, filename: "resume.pdf")
    )

    result = execute_graphql(<<~GQL, user: user, variables: { file: upload })
      mutation($file: Upload!) {
        parseResume(input: { file: $file }) { aiTask { taskType status } errors }
      }
    GQL

    expect(result.dig("data", "parseResume")).to eq(
      "aiTask" => { "taskType" => "PARSE_RESUME", "status" => "QUEUED" }, "errors" => []
    )
  end

  it "importParsedResume accepts the user's task without creating a resume" do
    ai_task = create(:ai_task, :completed_resume_parse, user: user)
    parsed_resume = ai_task.result["parsed_resume"]

    result = execute_graphql(<<~GQL, user: user, variables: { id: ai_task.id, parsedResume: parsed_resume })
      mutation($id: ID!, $parsedResume: JSON!) {
        importParsedResume(input: { aiTaskId: $id, parsedResume: $parsedResume }) {
          aiTask { id acceptedAt }
          errors
        }
      }
    GQL

    payload = result.dig("data", "importParsedResume")
    expect(payload["errors"]).to eq([])
    expect(payload.dig("aiTask", "id")).to eq(ai_task.id)
    expect(payload.dig("aiTask", "acceptedAt")).to be_present
    expect(user.resumes).to be_empty
  end

  it "imports grouped and separate same-company source blocks with owned bullet scopes" do
    ai_task = create(:ai_task, :completed_resume_parse, user: user)
    other_user = create(:user)
    other_entry = create(:experience, user: other_user, company: "Acme", title: "Consultant")
    payload = { "experiences" => [
      { "company" => "Acme", "roles" => [
        { "title" => "Lead", "highlights" => [ "Led delivery" ] },
        { "title" => "Engineer", "highlights" => [ "Built API" ] }
      ], "shared_highlights" => [ "Team award" ] },
      { "company" => "Acme", "roles" => [ { "title" => "Consultant", "highlights" => [ "Advised team" ] } ] }
    ] }

    result = execute_graphql(<<~GQL, user: user, variables: { id: ai_task.id, parsedResume: payload })
      mutation($id: ID!, $parsedResume: JSON!) {
        importParsedResume(input: { aiTaskId: $id, parsedResume: $parsedResume }) { aiTask { id } errors }
      }
    GQL

    expect(result.dig("data", "importParsedResume", "errors")).to eq([])
    expect(user.experiences.count).to eq(2)
    grouped = user.experiences.find { |entry| entry.roles.size == 2 }
    expect(grouped.roles.map(&:title)).to eq([ "Lead", "Engineer" ])
    expect(grouped.roles.map { |role| role.highlights.map(&:content) }).to eq([ [ "Led delivery" ], [ "Built API" ] ])
    expect(grouped.highlights.where(experience_role_id: nil).pluck(:content)).to eq([ "Team award" ])
    expect(other_entry.reload.highlights).to be_empty
    expect(other_user.experiences.count).to eq(1)
  end

  it "importParsedResume returns errors for a malformed parsed resume" do
    ai_task = create(:ai_task, :completed_resume_parse, user: user)

    result = execute_graphql(<<~GQL, user: user, variables: { id: ai_task.id, parsedResume: [ "not", "an object" ] })
      mutation($id: ID!, $parsedResume: JSON!) {
        importParsedResume(input: { aiTaskId: $id, parsedResume: $parsedResume }) { aiTask { id } errors }
      }
    GQL

    expect(result.dig("data", "importParsedResume")).to eq(
      "aiTask" => nil, "errors" => [ "Parsed resume must be an object" ]
    )
  end

  it "importParsedResume can't use another user's task" do
    other_task = create(:ai_task, :completed_resume_parse)

    result = execute_graphql(<<~GQL, user: user, variables: { id: other_task.id })
      mutation($id: ID!) {
        importParsedResume(input: { aiTaskId: $id, parsedResume: {} }) { errors }
      }
    GQL

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(other_task.reload).not_to be_accepted
  end
end

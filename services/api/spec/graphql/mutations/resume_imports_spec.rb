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

  it "importParsedResume creates a base resume from the user's task" do
    ai_task = create(:ai_task, :completed_resume_parse, user: user)
    parsed_resume = ai_task.result["parsed_resume"]

    result = execute_graphql(<<~GQL, user: user, variables: { id: ai_task.id, parsedResume: parsed_resume })
      mutation($id: ID!, $parsedResume: JSON!) {
        importParsedResume(input: { aiTaskId: $id, parsedResume: $parsedResume }) {
          resume { kind sections { sectionType } }
          errors
        }
      }
    GQL

    expect(result.dig("data", "importParsedResume")).to eq(
      "resume" => { "kind" => "BASE", "sections" => [ { "sectionType" => "CONTACT" } ] }, "errors" => []
    )
  end

  it "importParsedResume returns errors for a malformed parsed resume" do
    ai_task = create(:ai_task, :completed_resume_parse, user: user)

    result = execute_graphql(<<~GQL, user: user, variables: { id: ai_task.id, parsedResume: [ "not", "an object" ] })
      mutation($id: ID!, $parsedResume: JSON!) {
        importParsedResume(input: { aiTaskId: $id, parsedResume: $parsedResume }) { resume { id } errors }
      }
    GQL

    expect(result.dig("data", "importParsedResume")).to eq(
      "resume" => nil, "errors" => [ "Parsed resume must be an object" ]
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

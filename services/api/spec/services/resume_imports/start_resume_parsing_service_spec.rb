# Description: Storing an uploaded resume and queueing the parse_resume task.
require "rails_helper"

RSpec.describe ResumeImports::StartResumeParsingService do
  let(:user) { create(:user) }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }

  before { allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue) }

  it "uploads a PDF, attaches it to a queued parse_resume task, and sends its key" do
    file = build_uploaded_file(content: minimal_pdf_bytes, filename: "jane.pdf")

    result = described_class.call(user: user, file: file)

    expect(result).to be_success
    ai_task = result.value
    expect(ai_task).to be_parse_resume.and be_queued
    expect(ai_task.source_file.download).to eq(minimal_pdf_bytes)
    expect(ai_task.input["source_file"]).to eq(
      "key" => ai_task.source_file.blob.key, "filename" => "jane.pdf", "content_type" => "application/pdf"
    )
    expect(queue).to have_received(:send_message)
  end

  it "rejects files that aren't PDF or DOCX, whatever the client claims" do
    file = build_uploaded_file(content: "just text", filename: "resume.pdf", content_type: "application/pdf")

    result = described_class.call(user: user, file: file)

    expect(result.errors).to eq([ "Resume must be a PDF or DOCX file" ])
    expect(user.ai_tasks).to be_empty
    expect(ActiveStorage::Blob.count).to eq(0)
  end

  it "rejects files over 5 MB" do
    file = build_uploaded_file(content: minimal_pdf_bytes + ("x" * 5.megabytes), filename: "big.pdf")

    result = described_class.call(user: user, file: file)

    expect(result.errors).to eq([ "Resume file must be 5 MB or smaller" ])
    expect(queue).not_to have_received(:send_message)
  end
end

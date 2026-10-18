# Delete saved snapshots through the public API without removing their source data or history.
require "rails_helper"

RSpec.describe "Delete resume" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:resume) { create(:resume, user: user, job: job) }
  let(:query) do
    <<~GQL
      mutation($id: ID!) { deleteResume(input: { id: $id }) { resume { id } errors } }
    GQL
  end

  it "deletes the owned resume and its sections while keeping source data and task history" do
    section = create(:resume_section, resume: resume)
    fact = create(:library_fact, user: user)
    task = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed", accepted_at: Time.current)
    accepted_at = task.accepted_at

    result = execute_graphql(query, user: user, variables: { id: resume.id })

    expect(result.dig("data", "deleteResume")).to eq("resume" => { "id" => resume.id }, "errors" => [])
    expect(Resume.exists?(resume.id)).to be(false)
    expect(ResumeSection.exists?(section.id)).to be(false)
    expect(job.reload).to be_persisted
    expect(fact.reload).to be_persisted
    expect(task.reload.accepted_at).to eq(accepted_at)
    expect(task).to be_completed
  end

  it "deletes a resume whose job was removed" do
    resume
    job.destroy!

    result = execute_graphql(query, user: user, variables: { id: resume.id })

    expect(result.dig("data", "deleteResume", "errors")).to eq([])
    expect(Resume.exists?(resume.id)).to be(false)
  end

  it "hides other users' resumes and missing IDs" do
    other = create(:resume)
    [ other.id, SecureRandom.uuid ].each do |id|
      result = execute_graphql(query, user: user, variables: { id: id })
      expect(result["errors"].first["message"]).to eq("Record not found")
    end
    expect(other.reload).to be_persisted
  end
end

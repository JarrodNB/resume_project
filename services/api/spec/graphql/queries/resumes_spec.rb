# Exercises the real saved-resume list, including owned resumes whose jobs were removed.
require "rails_helper"

RSpec.describe "Saved resume list" do
  it "lists owned Markdown resumes with linked or deleted jobs without section associations" do
    user = create(:user)
    linked = create(:resume, user: user)
    orphan = create(:resume, user: user)
    orphan.job.destroy!
    foreign = create(:resume)
    query = <<~GQL
      query Resumes {
        resumes { id title updatedAt job { id title company } }
      }
    GQL

    result = execute_graphql(query, user: user)

    expect(result["errors"]).to be_nil
    rows = result.dig("data", "resumes")
    expect(rows.map { |row| row["id"] }).to contain_exactly(linked.id, orphan.id)
    expect(rows.map { |row| row["id"] }).not_to include(foreign.id)
    expect(rows.find { |row| row["id"] == linked.id }.dig("job", "id")).to eq(linked.job_id)
    expect(rows.find { |row| row["id"] == orphan.id }["job"]).to be_nil
  end
end

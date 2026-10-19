# Test explicit shared-listing import through the schema and real owner-scoped writes.
require "rails_helper"

RSpec.describe "Job Board import" do
  let(:user) { create(:user) }
  let(:listing) do
    create(:job_board_listing, payload: { "title" => "Engineer", "company" => { "name" => "Acme" },
      "description" => "<h2>Requirements</h2><ul><li>Ruby</li></ul>", "application_url" => "https://example.com/apply?utm_source=board" })
  end

  def import(id = listing.id, owner: user)
    execute_graphql(<<~GQL, user: owner, variables: { id: id })
      mutation($id: ID!) {
        importJobBoardListing(input: { listingId: $id }) {
          job { id title company stage description requirements } warnings errors
        }
      }
    GQL
  end

  it "creates a normal private Job once, preserves edits, and allows another owner's separate copy" do
    expect(JobBoard::SearchCleanJobDataService).not_to receive(:call)
    expect { @first = import }.to change(Job, :count).by(1).and change(AiTask, :count).by(0)
    payload = @first.dig("data", "importJobBoardListing")
    expect(payload).to include("errors" => [], "warnings" => [])
    expect(payload["job"]).to include("title" => "Engineer", "company" => "Acme", "stage" => "UNAPPLIED", "requirements" => [ "Ruby" ])
    job = user.jobs.find(payload["job"]["id"])
    job.update!(title: "Edited")
    expect { @again = import }.not_to change(Job, :count)
    expect(@again.dig("data", "importJobBoardListing", "job")).to include("id" => job.id, "title" => "Edited")
    other = create(:user)
    expect(import(owner: other).dig("data", "importJobBoardListing", "job", "id")).not_to eq(job.id)
  end

  it "reuses only the current owner's normalized URL match" do
    create(:job, url: "https://example.com/apply")
    own = create(:job, user: user, url: "https://example.com/apply#top")
    expect { @result = import }.not_to change(Job, :count)
    expect(@result.dig("data", "importJobBoardListing", "job", "id")).to eq(own.id)
  end

  it "returns omission warnings and ordinary validation errors" do
    listing.update!(payload: listing.payload.merge("description" => "x" * (TextLimits::JOB_DESCRIPTION + 1)))
    expect(import.dig("data", "importJobBoardListing", "warnings")).to eq([ JobBoard::ImportListingService::LEFT_OUT_WARNING ])
    invalid = create(:job_board_listing, payload: { "title" => "" })
    expect(import(invalid.id).dig("data", "importJobBoardListing")).to include("job" => nil, "warnings" => [], "errors" => [ "Title can't be blank" ])
  end

  it "returns the existing not-found contract for unknown and malformed IDs" do
    [ SecureRandom.uuid, "not-an-id" ].each do |id|
      expect(import(id)["errors"].first["message"]).to eq("Record not found")
    end
  end
end

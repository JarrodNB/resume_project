# Importing exercises saved state at the public service boundary, without provider or AI calls.
require "rails_helper"

RSpec.describe JobBoard::ImportListingService do
  let(:user) { create(:user) }
  let(:listing) { create(:job_board_listing, payload: { "title" => "Engineer", "company" => { "name" => "Example" }, "location" => "US", "application_url" => "https://example.com/apply?id=1", "description" => "<h2>Requirements</h2><ul><li>Ruby &amp; SQL</li></ul>" }) }

  it "copies a private initial-stage snapshot without scheduling AI" do
    expect { @result = described_class.call(user: user, listing: listing) }.to change(user.jobs, :count).by(1).and change(AiTask, :count).by(0)
    expect(@result).to be_success
    job = @result.value[:job]
    expect(job.screened_fields).to be_empty
    expect(job.attributes).to include("title" => "Engineer", "company" => "Example", "location" => "US", "url" => "https://example.com/apply?id=1", "stage" => "unapplied", "requirements" => [ "Ruby & SQL" ])
    expect(job.description).to include("Requirements", "- Ruby & SQL")
    expect(job.description).not_to include("<")
  end
  def import(owner = user, source = listing)
    described_class.call(user: owner, listing: source)
  end

  it "derives new import locations from a legacy catalogue snapshot" do
    listing.update!(payload: listing.payload.except("location").merge("locations" => [
      { "country_code" => "US", "city_name" => "Alpharetta", "state_code" => "GA" }
    ]))
    expect(import.value[:job].location).to eq("Alpharetta, GA, US")
  end

  it "preserves an existing blank location when the provider gains a location" do
    job = import.value[:job]
    job.update!(location: nil)
    listing.update!(payload: listing.payload.merge("locations" => [ { "country_code" => "US", "city_name" => "Alpharetta", "state_code" => "GA" } ]))
    expect(import.value[:job].reload.location).to be_nil
  end

  it "keeps edits and application state on repeated imports" do
    job = import.value[:job]
    job.update!(title: "My edited title", location: "My location", stage: "applied", url: "https://edited.test")
    listing.update!(payload: listing.payload.merge("title" => "Provider refresh"))
    expect { expect(import.value[:job]).to eq(job) }.not_to change(Job, :count)
    expect(job.reload).to have_attributes(title: "My edited title", location: "My location", stage: "applied", url: "https://edited.test")
  end

  it "reuses a tracked URL match without overwriting the saved application" do
    job = create(:job, user: user, url: "https://example.com/apply?utm_source=email&id=1#top", stage: "offer")
    expect(import.value[:job]).to eq(job)
    expect(job.reload).to have_attributes(stage: "offer", job_board_listing_id: listing.id, title: "AI Engineer")
  end

  it "preserves another source identity on a URL match" do
    other = create(:job_board_listing, payload: {})
    job = create(:job, user: user, job_board_listing: other, url: listing.payload["application_url"])
    expect(import.value[:job]).to eq(job)
    expect(job.reload.job_board_listing_id).to eq(other.id)
  end

  it "does not remove meaningful parameters or change paths" do
    %w[https://example.com/apply?id=2 https://example.com/other?id=1 https://example.com/apply?id=1&ref=abc https://example.com/apply?id=1&source=abc https://example.com/apply?id=1&id=2].each do |url|
      create(:job, user: user, url: url)
    end
    expect { import }.to change(user.jobs, :count).by(1)
  end

  it "preserves meaningful duplicate query parameter order" do
    listing.update!(payload: listing.payload.merge("application_url" => "https://example.com/apply?id=1&id=2"))
    create(:job, user: user, url: "https://example.com/apply?id=2&id=1")
    expect { import }.to change(user.jobs, :count).by(1)
  end

  it "creates separate private jobs for different users and leaves their snapshots alone" do
    first = import.value[:job]
    second = import(create(:user)).value[:job]
    expect(first.id).not_to eq(second.id)
    listing.update!(payload: listing.payload.merge("description" => "Updated", "title" => "New title"))
    expect(first.reload.title).to eq("Engineer")
    expect(second.reload.description).to include("Ruby & SQL")
  end

  it "accepts absent company and description with empty qualification lists" do
    listing.update!(payload: { "title" => "Engineer" })
    expect(import.value[:job]).to have_attributes(company: nil, description: "", requirements: [], responsibilities: [], nice_to_haves: [])
  end

  it "uses headings only, resets on unrelated headings, and keeps nested bullet text separate" do
    listing.update!(payload: listing.payload.merge("description" => <<~HTML))
      <ul><li>Unclassified</li></ul><p><b>Requirements</b></p>
      <ul><li>Ruby<ul><li>SQL</li></ul></li><li>Own <strong>systems</strong>.</li></ul>
      <h2>Benefits</h2><ul><li>Insurance</li></ul>
      <p>What you'll do:</p><ul><li>Ship software</li></ul>
      <div><strong>Preferred qualifications:</strong></div><ul><li>Python</li></ul>
      <p>This paragraph mentions skills but is not a heading.</p>
    HTML
    expect(import.value[:job]).to have_attributes(requirements: [ "Ruby", "SQL", "Own systems." ], responsibilities: [ "Ship software" ], nice_to_haves: [ "Python" ])
  end

  it "recognizes headings whose words are split across inline tags" do
    listing.update!(payload: listing.payload.merge("description" => "<p><strong>Preferred</strong><b>qualifications</b></p><ul><li>SQL</li></ul>"))
    expect(import.value[:job].nice_to_haves).to eq([ "SQL" ])
  end

  it "does not infer requirements from plain prose or unheaded bullets" do
    listing.update!(payload: listing.payload.merge("description" => "<p>Requirements include Ruby.</p><ul><li>Ruby</li></ul><script>alert(1)</script>"))
    job = import.value[:job]
    expect(job.requirements).to eq([])
    expect(job.description).not_to include("alert")
  end

  it "truncates fields, drops oversized or excess bullets, and omits long URLs with warnings" do
    bullets = [ "x" * (TextLimits::BULLET + 1) ] + Array.new(81) { |i| "Requirement #{i}" }
    listing.update!(payload: { "title" => "T" * 201, "company" => { "name" => "C" * 201 }, "location" => "L" * 201,
      "application_url" => "https://example.com/" + "x" * 201,
      "description" => "<h2>Requirements</h2><ul>" + bullets.map { |b| "<li>#{b}</li>" }.join + "</ul>" + "D" * 20_001 })
    result = import
    expect(result).to be_success
    job = result.value[:job]
    expect(job).to have_attributes(title: "T" * 200, company: "C" * 200, location: "L" * 200, url: nil, job_board_listing_id: listing.id)
    expect(job.description.length).to eq(TextLimits::JOB_DESCRIPTION)
    expect(job.requirements).to eq(Array.new(80) { |i| "Requirement #{i}" })
    expect(result.value[:warnings]).not_to be_empty
  end

  it "returns model validation errors without creating an invalid job" do
    listing.update!(payload: { "title" => "" })
    expect { @invalid_result = import }.not_to change(user.jobs, :count)
    expect(@invalid_result).not_to be_success
    expect(@invalid_result.errors).not_to be_empty
  end

  it "allows deletion of a saved job without deleting its catalogue listing" do
    import.value[:job].destroy!
    expect(JobBoardListing.exists?(listing.id)).to be(true)
    expect(import).to be_success
  end

  it "retains saved snapshots if a catalogue listing is deleted" do
    job = import.value[:job]
    listing.destroy!
    expect(job.reload).to have_attributes(title: "Engineer", job_board_listing_id: nil)
  end

  it "enforces source uniqueness in the database while allowing normal manual jobs" do
    import
    expect { user.jobs.create!(title: "Duplicate", job_board_listing: listing) }.to raise_error(ActiveRecord::RecordNotUnique)
  end
end

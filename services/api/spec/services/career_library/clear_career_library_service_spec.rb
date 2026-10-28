# Description: Emptying a career library, leaving other users and non-library records alone,
# and queueing one embedding sync only when an entry was removed.
require "rails_helper"

RSpec.describe CareerLibrary::ClearCareerLibraryService do
  include ActiveJob::TestHelper

  let(:user) do
    create(:user, name: "Ada", contact_email: "ada@example.com", phone: "555", location: "Perth", links: [ { "label" => "GitHub", "url" => "https://github.com/ada" } ], summary: "Engineer")
  end

  it "removes every library entry, clears the profile an import fills, and keeps the account" do
    experience = create(:experience, user: user)
    create(:experience_highlight, experience: experience, content: "Shipped it")
    create(:project, user: user)
    create(:education, user: user)
    create(:skill, user: user)
    context = create(:career_context, user: user)
    job = create(:job, user: user)
    response = create(:job_gap_response, job: job, career_context: context)
    resume = create(:resume, user: user, job: job)

    result = described_class.call(user: user)

    expect(result).to be_success
    expect(user.experiences).to be_empty
    expect(user.projects).to be_empty
    expect(user.educations).to be_empty
    expect(user.skills).to be_empty
    expect(user.career_contexts).to be_empty
    expect(ExperienceHighlight.exists?(experience_id: experience.id)).to be(false)
    expect(user.reload).to have_attributes(
      email: user.email, name: nil, contact_email: nil, phone: nil, location: nil, links: [], summary: nil
    )
    expect(response.reload.career_context_id).to be_nil
    expect(Job.exists?(job.id)).to be(true)
    expect(Resume.exists?(resume.id)).to be(true)
  end

  it "leaves another user's library alone" do
    mine = create(:experience, user: user)
    theirs = create(:experience)

    described_class.call(user: user)

    expect(Experience.exists?(mine.id)).to be(false)
    expect(Experience.exists?(theirs.id)).to be(true)
  end

  it "doesn't queue a sync when only the profile is cleared" do
    expect { described_class.call(user: user) }.not_to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob)
    expect(user.reload.name).to be_nil
  end

  it "queues one embedding sync when an entry is removed, and none when the library is already empty" do
    create(:skill, user: user)

    expect { described_class.call(user: user) }
      .to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob).with(user.id).once
    expect { described_class.call(user: user) }
      .not_to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob)
  end
  it "clears certifications only for the owner" do
    credential = create(:certification, user: user)
    theirs = create(:certification)
    expect(described_class.call(user: user)).to be_success
    expect(Certification.exists?(credential.id)).to be(false)
    expect(theirs.reload).to be_persisted
    expect(described_class.call(user: user)).to be_success
  end

end

# Description: Saving a gap response on a job, and optionally as a career context.
# A job-only answer never queues an embedding sync.
require "rails_helper"

RSpec.describe GapResponses::SaveGapResponseService do
  include ActiveJob::TestHelper

  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:requirement) { "Experience with Kubernetes" }
  let(:sync_job) { CareerLibrary::SyncLibraryEmbeddingsJob }

  def save(body:, add_to_library:, job: self.job)
    described_class.call(job: job, requirement: requirement, body: body, add_to_library: add_to_library)
  end

  it "saves an answer on the job without embedding it" do
    expect { save(body: "Used it at Acme", add_to_library: false) }
      .not_to have_enqueued_job(sync_job)

    response = job.gap_responses.sole
    expect(response).to have_attributes(requirement: requirement, body: "Used it at Acme", career_context: nil)
    expect(user.career_contexts.reload).to be_empty
  end

  it "updates the same answer when the requirement text matches" do
    save(body: "Used it at Acme", add_to_library: false)

    result = save(body: "  Used it at Acme for two years  ", add_to_library: false)

    expect(result.value.body).to eq("Used it at Acme for two years")
    expect(job.gap_responses.count).to eq(1)
  end

  it "adds a library context and queues an embedding sync" do
    expect { save(body: "Used it at Acme", add_to_library: true) }
      .to have_enqueued_job(sync_job).with(user.id)

    context = user.career_contexts.sole
    expect(context).to have_attributes(requirement: requirement, response: "Used it at Acme")
    expect(job.gap_responses.sole.career_context).to eq(context)
  end

  it "doesn't queue a sync when the context's text is unchanged" do
    save(body: "Used it at Acme", add_to_library: true)

    expect { save(body: "Used it at Acme", add_to_library: true) }
      .not_to have_enqueued_job(sync_job)
  end

  it "shares one context between jobs with the same requirement, and the later answer wins" do
    other_job = create(:job, user: user)
    save(body: "Used it at Acme", add_to_library: true)

    save(body: "Used it at Acme and Now Co", add_to_library: true, job: other_job)

    expect(user.career_contexts.sole.response).to eq("Used it at Acme and Now Co")
    expect(user.career_contexts.count).to eq(1)
    expect(job.gap_responses.sole.body).to eq("Used it at Acme")
    expect(other_job.gap_responses.sole.career_context).to eq(job.gap_responses.sole.career_context)
  end

  it "removes the context when the answer is no longer added to the library" do
    save(body: "Used it at Acme", add_to_library: true)

    expect { save(body: "Used it at Acme", add_to_library: false) }
      .to have_enqueued_job(sync_job).with(user.id)

    expect(user.career_contexts.reload).to be_empty
    expect(job.gap_responses.sole.career_context).to be_nil
  end

  it "keeps the context while another job's answer still points at it" do
    other_job = create(:job, user: user)
    save(body: "Used it at Acme", add_to_library: true)
    save(body: "Used it at Acme", add_to_library: true, job: other_job)

    expect { save(body: "Used it at Acme", add_to_library: false) }
      .not_to have_enqueued_job(sync_job)

    expect(user.career_contexts.count).to eq(1)
    expect(other_job.gap_responses.sole.career_context).to eq(user.career_contexts.sole)
  end

  it "clears a blank answer and the context it was the only link to" do
    save(body: "Used it at Acme", add_to_library: true)

    result = save(body: "   ", add_to_library: true)

    expect(result.value).to be_nil
    expect(job.gap_responses.reload).to be_empty
    expect(user.career_contexts.reload).to be_empty
  end

  it "clearing an answer that was never saved does nothing" do
    expect(save(body: "", add_to_library: false).value).to be_nil
    expect(job.gap_responses).to be_empty
  end

  it "rejects a blank requirement" do
    result = described_class.call(job: job, requirement: "  ", body: "Used it", add_to_library: false)

    expect(result.errors).to eq([ "Requirement can't be blank" ])
    expect(job.gap_responses).to be_empty
  end

  [ "", "Edited answer" ].each do |new_body|
    it "rolls back answer changes when context removal fails (body: #{new_body.inspect})" do
      save(body: "Original answer", add_to_library: true)
      response = job.gap_responses.sole
      response.update!(screened_fields: %w[requirement body])
      context = response.career_context
      # Exercise the handled deletion-failure seam after real answer writes occurred.
      allow(Records::DestroyRecordService).to receive(:call).with(record: context)
        .and_return(ServiceResult.new(success: false, value: nil, errors: [ "Couldn't remove context" ]))

      expect(save(body: new_body, add_to_library: false)).not_to be_success
      expect(response.reload).to have_attributes(body: "Original answer", career_context_id: context.id)
      expect(response.screened_fields).to match_array(%w[requirement body])
      expect(context.reload.response).to eq("Original answer")
    end
  end
end

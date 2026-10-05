# Description: Every service that changes the career library's text queues an embedding sync for
# the user; changes that leave the text alone (reordering within a role, deleting a job) don't.
require "rails_helper"

RSpec.describe "Career library embedding sync enqueueing" do
  include ActiveJob::TestHelper

  let(:user) { create(:user) }
  let(:sync_job) { CareerLibrary::SyncLibraryEmbeddingsJob }

  it "queues a sync when an experience is created or updated" do
    expect { Experiences::CreateExperienceService.call(user: user, attributes: { company: "Acme", title: "Engineer" }) }
      .to have_enqueued_job(sync_job).with(user.id)

    experience = user.experiences.sole
    expect { Experiences::UpdateExperienceService.call(experience: experience, attributes: { title: "Lead" }) }
      .to have_enqueued_job(sync_job).with(user.id)
  end

  it "doesn't queue a sync when saving fails" do
    expect { Experiences::CreateExperienceService.call(user: user, attributes: { company: "", title: "" }) }
      .not_to have_enqueued_job(sync_job)
  end

  it "queues a sync when two entries are merged" do
    target = create(:project, user: user, name: "CLI")
    source = create(:project, user: user, name: "cli")

    expect { CareerLibrary::MergeLibraryRecordsService.call(target: target, source: source) }
      .to have_enqueued_job(sync_job).with(user.id)
  end

  it "queues a sync when a highlight moves to another role, not when it is reordered" do
    first_role = create(:experience, user: user)
    second_role = create(:experience, user: user)
    highlight = create(:experience_highlight, experience: first_role)

    expect { Experiences::MoveHighlightService.call(highlight: highlight, experience: first_role, position: 0) }
      .not_to have_enqueued_job(sync_job)
    expect { Experiences::MoveHighlightService.call(highlight: highlight, experience: second_role, position: 0) }
      .to have_enqueued_job(sync_job).with(user.id)
  end

  it "queues a sync when a library entry is deleted, not a job" do
    expect { Records::DestroyRecordService.call(record: create(:skill, user: user)) }
      .to have_enqueued_job(sync_job).with(user.id)
    expect { Records::DestroyRecordService.call(record: create(:job, user: user)) }
      .not_to have_enqueued_job(sync_job)
  end

  it "queues a sync after a resume import" do
    ai_task = create(:ai_task, user: user, task_type: "parse_resume", status: "completed")
    parsed_resume = { "skills" => [ { "name" => "Ruby" } ] }

    expect { ResumeImports::ImportParsedResumeService.call(ai_task: ai_task, parsed_resume: parsed_resume) }
      .to have_enqueued_job(sync_job).with(user.id)
  end
end

# Description: Every service that changes the career library's text queues an embedding sync for
# the user; changes that leave the text alone (reordering within a role, deleting a job) don't.
require "rails_helper"

RSpec.describe "Career library embedding sync enqueueing" do
  include ActiveJob::TestHelper

  let(:user) { create(:user) }
  let(:sync_job) { CareerLibrary::SyncLibraryEmbeddingsJob }

  it "queues a sync when any library entry is created or updated (see save_library_entry_service_spec)" do
    %i[experience project education skill certification career_context].each do |kind|
      attributes = attributes_for(kind)
      expect { CareerLibrary::SaveLibraryEntryService.call(user: user, kind: kind, attributes: attributes) }
        .to have_enqueued_job(sync_job).with(user.id)
    end
  end

  it "doesn't queue a sync for a profile update or a failed library save" do
    expect { Users::UpdateProfileService.call(user: user, attributes: { name: "Ada" }) }
      .not_to have_enqueued_job(sync_job)
    expect { CareerLibrary::SaveLibraryEntryService.call(user: user, kind: :project, attributes: { name: "" }) }
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

  it "queues one sync when the library is emptied, and none when it is already empty" do
    create(:skill, user: user)

    expect { CareerLibrary::ClearCareerLibraryService.call(user: user) }
      .to have_enqueued_job(sync_job).with(user.id).once
    expect { CareerLibrary::ClearCareerLibraryService.call(user: user) }
      .not_to have_enqueued_job(sync_job)
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

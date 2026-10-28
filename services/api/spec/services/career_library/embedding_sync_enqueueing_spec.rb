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

  it "queues a sync when a project, education, skill, or context is created or updated" do
    expect { Projects::CreateProjectService.call(user: user, attributes: { name: "CLI" }) }
      .to have_enqueued_job(sync_job).with(user.id)
    project = user.projects.sole
    expect { Projects::UpdateProjectService.call(project: project, attributes: { role: "Author" }) }
      .to have_enqueued_job(sync_job).with(user.id)

    expect { Educations::CreateEducationService.call(user: user, attributes: { institution: "State" }) }
      .to have_enqueued_job(sync_job).with(user.id)
    education = user.educations.sole
    expect { Educations::UpdateEducationService.call(education: education, attributes: { degree: "BSc" }) }
      .to have_enqueued_job(sync_job).with(user.id)

    expect { Skills::CreateSkillService.call(user: user, attributes: { name: "Ruby" }) }
      .to have_enqueued_job(sync_job).with(user.id)
    skill = user.skills.sole
    expect { Skills::UpdateSkillService.call(skill: skill, attributes: { category: "Languages" }) }
      .to have_enqueued_job(sync_job).with(user.id)

    expect { CareerContexts::CreateCareerContextService.call(user: user, attributes: { requirement: "K8s", response: "Yes" }) }
      .to have_enqueued_job(sync_job).with(user.id)
    context = user.career_contexts.sole
    expect { CareerContexts::UpdateCareerContextService.call(career_context: context, attributes: { response: "Two years" }) }
      .to have_enqueued_job(sync_job).with(user.id)
  end

  it "doesn't queue a sync for a profile update or a failed library save" do
    expect { Users::UpdateProfileService.call(user: user, attributes: { name: "Ada" }) }
      .not_to have_enqueued_job(sync_job)
    expect { Projects::CreateProjectService.call(user: user, attributes: { name: "" }) }
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

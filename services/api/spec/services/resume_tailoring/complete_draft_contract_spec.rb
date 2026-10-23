# A completed draft can be edited and saved directly without section submissions or requeueing.
# These checks keep resume snapshots independent of career-library records and AI work.
require "rails_helper"

RSpec.describe "Complete draft editing and saving" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:ai_task) do
    create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed",
           input: { "job_id" => job.id }, result: { "sections" => [ summary ] })
  end
  let(:summary) { { "section_type" => "summary", "content" => { "text" => "Original draft" } } }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }

  before do
    allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue)
    allow(ApiSchema.subscriptions).to receive(:trigger)
  end

  it "saves an edit without changing task snapshots or queueing more work" do
    edit = summary.merge("content" => { "text" => "Backend engineer." })

    result = ResumeTailoring::SaveTailoredResumeService.call(ai_task: ai_task, sections: [ edit ])

    expect(result).to be_success
    expect(result.value.sections.sole.content).to eq("text" => "Backend engineer.")
    expect(ai_task.reload.input).to eq("job_id" => job.id)
    expect(ai_task.result).to eq("sections" => [ summary ])
    expect(queue).not_to have_received(:send_message)
  end

  it "omits an excluded section even when its original text exceeded the screening cap" do
    excluded = { "section_type" => "experience", "content" => { "text" => "a" * (TextLimits::SCREENED_TEXT + 1) } }
    ai_task.update!(result: { "sections" => [ excluded, summary ] })

    result = ResumeTailoring::SaveTailoredResumeService.call(ai_task: ai_task, sections: [ summary ])

    expect(result).to be_success
    expect(result.value.sections.pluck(:section_type)).to eq([ "summary" ])
    expect(queue).not_to have_received(:send_message)
  end

  it "refuses an oversized final edit before accepting the draft" do
    text = "a" * (TextLimits::SCREENED_TEXT + 1)

    result = ResumeTailoring::SaveTailoredResumeService.call(ai_task: ai_task,
      sections: [ summary.merge("content" => { "text" => text }) ])

    expect(result.errors).to eq([ TextLimits::SECTION_TOO_LONG ])
    expect(user.resumes).to be_empty
    expect(ai_task.reload).not_to be_accepted
    expect(queue).not_to have_received(:send_message)
  end

  it "refuses saving while the whole draft is still queued" do
    ai_task.update!(status: "queued")

    result = ResumeTailoring::SaveTailoredResumeService.call(ai_task: ai_task, sections: [ summary ])

    expect(result.errors).to eq([ ResumeTailoring::SaveTailoredResumeService::NOT_READY_MESSAGE ])
    expect(user.resumes).to be_empty
    expect(queue).not_to have_received(:send_message)
  end

  it "can edit a credential and exclude another without changing the library" do
    included = create(:certification, user: user)
    excluded = create(:certification, user: user, name: "Other credential")
    edited = { "section_type" => "certifications", "content" => { "items" => [ { "name" => "Edited credential" } ] } }
    original = { "section_type" => "certifications", "content" => { "items" => [ { "name" => included.name }, { "name" => excluded.name } ] } }
    ai_task.update!(result: { "sections" => [ summary, original ] })

    result = ResumeTailoring::SaveTailoredResumeService.call(ai_task: ai_task, sections: [ edited ])

    expect(result).to be_success
    expect(result.value.sections.sole.content).to eq(edited["content"])
    expect(included.reload.name).to eq("AWS Solutions Architect")
    expect(excluded.reload.name).to eq("Other credential")
    expect(queue).not_to have_received(:send_message)
  end
  it "saves and edits grouped role snapshots without rewriting historical flat task JSON" do
    original = { "section_type" => "experience", "content" => { "items" => [
      { "company" => "Example", "title" => "Engineer", "highlights" => [ "Built tools" ] }
    ] } }
    ai_task.update!(result: { "sections" => [ original ] })
    grouped = { "section_type" => "experience", "content" => { "items" => [
      { "company" => "Example", "source_experience_id" => "employment", "highlights" => [ "Built tools" ],
        "highlight_source_ids" => [ [ "shared" ] ], "roles" => [
          { "id" => "senior", "title" => "Senior Engineer", "start_date" => "2025-01",
            "highlights" => [ "Led migrations" ], "highlight_source_ids" => [ [ "scoped" ] ] },
          { "id" => "earlier", "title" => "Engineer", "start_date" => "2020-01", "end_date" => "2024-12", "highlights" => [] }
        ] },
      { "company" => "Example", "roles" => [ { "title" => "Support Engineer", "highlights" => [] } ], "highlights" => [] }
    ] } }

    saved = ResumeTailoring::SaveTailoredResumeService.call(ai_task: ai_task, sections: [ grouped ])
    expect(saved).to be_success
    section = saved.value.sections.sole
    expect(section.content).to eq(grouped["content"])
    edited = section.content.deep_dup
    edited["items"][0]["roles"][0]["title"] = "Staff Engineer"
    updated = ResumeTailoring::UpdateResumeSectionsService.call(resume: saved.value,
      sections: [ { "id" => section.id, "content" => edited } ])

    expect(updated).to be_success
    expect(section.reload.content).to eq(edited)
    expect(ai_task.reload.result).to eq("sections" => [ original ])
    expect(queue).not_to have_received(:send_message)
  end

end

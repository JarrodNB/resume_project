# Extend the same owned review/edit flow to summary, project descriptions, and fact answers.
require "rails_helper"

RSpec.describe "Career library narrative AI targets" do
  let(:user) { create(:user, summary: "I build practical internal tools.") }
  let!(:project) { create(:project, user: user, description: "Built a shared inventory sheet.") }
  let!(:fact) { create(:library_fact, user: user, requirement: "Inventory experience", response: "I maintained the count sheet.") }
  let(:queue) { double("queue", send_message: nil) }

  before { allow(Shoryuken::Client).to receive(:queues).and_return(queue) }

  def target(section)
    case section
    when "summary" then [ "user", user, "summary" ]
    when "projects" then [ "project", project, "description" ]
    when "facts" then [ "library_fact", fact, "response" ]
    end
  end

  def review(section)
    execute_graphql(<<~GQL, user: user).dig("data", "reviewLibrarySection")
      mutation { reviewLibrarySection(input: {section: "#{section}"}) { aiTask { id input } errors } }
    GQL
  end

  def edit(section, owner: user, id: nil)
    kind, record = target(section)
    execute_graphql(<<~GQL, user: owner).dig("data", "startLibraryEdit")
      mutation { startLibraryEdit(input: {kind: "#{kind}", recordId: "#{id || record.id}", feedback: "Make this clearer"}) { aiTask { id input } errors } }
    GQL
  end

  def complete(task, text = "Clearer wording supported by the user's supplied facts.")
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "message_history" => [],
      "result" => { "text" => text, "color" => "yellow", "reason" => "Add an outcome if known." } })
  end

  def accept(task)
    execute_graphql(<<~GQL, user: user).dig("data", "acceptLibraryEdit")
      mutation { acceptLibraryEdit(input: {aiTaskId: "#{task.id}"}) { aiTask { acceptedAt } errors } }
    GQL
  end

  %w[summary projects facts].each do |section|
    it "reviews only owned #{section} narrative targets" do
      create(:experience, user: user)
      create(:project)
      create(:library_fact)
      payload = review(section)
      expect(payload["errors"]).to eq([])
      input = payload.dig("aiTask", "input")
      kind, record, field = target(section)
      expect(input["targets"].map { |item| item.values_at("kind", "record_id", "field") }).to eq([[kind, record.id, field]])
      expect(input["library"].keys).to match_array(section == "summary" ? %w[summary_record_id summary screened_fields] : [section])
      expect(input.to_json).not_to include("contact_email", "credential_id", "experiences")
    end

    it "accepts exactly the #{section} field and revokes generated coverage after a manual edit" do
      kind, record, field = target(section)
      before_profile = user.attributes.slice("name", "contact_email", "phone", "links")
      before_requirement = fact.requirement
      started = edit(section)
      expect(started["errors"]).to eq([])
      task = AiTask.find(started.dig("aiTask", "id"))
      expect(task.input["section"]).to eq(section)
      expect(task.input["targets"].length).to eq(1)
      complete(task)
      acceptance = -> { expect(accept(task)["errors"]).to eq([]) }
      if kind == "user"
        expect(&acceptance).not_to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob)
      else
        expect(&acceptance).to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob).with(user.id)
      end
      expect(record.reload[field]).to eq(task.reload.result["text"])
      expect(record.screened_fields).to include(field)
      expect(user.reload.attributes.slice("name", "contact_email", "phone", "links")).to eq(before_profile)
      expect(fact.reload.requirement).to eq(before_requirement)
      state = CareerLibrary::ReviewStateService.call(user: user, section: section).value
      expect(state[:assessments].first.slice("record_id", "color", "stale")).to eq("record_id" => record.id, "color" => "yellow", "stale" => false)

      case kind
      when "user" then Users::UpdateProfileService.call(user: user, attributes: { summary: "New user summary" })
      when "project" then Projects::UpdateProjectService.call(project: project, attributes: { description: "New user description" })
      when "library_fact" then LibraryFacts::UpdateLibraryFactService.call(library_fact: fact, attributes: { response: "New user response" })
      end
      expect(record.reload.screened_fields).not_to include(field)
      expect(CareerLibrary::ReviewStateService.call(user: user, section: section).value[:assessments].first["stale"]).to be(true)
    end

    it "keeps #{section} source checks fresh and rejects other owners and changed drafts" do
      kind, record, field = target(section)
      expect(edit(section, owner: create(:user))["errors"]).to eq([ "Record not found" ])
      started = edit(section)
      expect(started["errors"]).to eq([])
      task = AiTask.find(started.dig("aiTask", "id"))
      record.update!(field => "New unchecked user content")
      AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "failed", "error_message" => "Generation failed",
        "library_screening" => [{ "record_type" => kind, "record_id" => record.id, "fields" => [field] }] })
      expect(record.reload.screened_fields).not_to include(field)
      # A completed proposal based on the old source cannot overwrite the new value.
      newer = AiTask.find(edit(section).dig("aiTask", "id"))
      complete(newer)
      record.update!(field => "Changed again while generating")
      expect(accept(newer)["errors"]).to include("This entry changed. Start a new edit from its current text.")
      expect(record.reload[field]).to eq("Changed again while generating")
    end
  end
end

# Review the Experience section without changing saved career facts.
require "rails_helper"

RSpec.describe "Career library section review" do
  let(:user) { create(:user) }
  let!(:role) { create(:experience, user: user, description: "Built services") }
  let!(:highlight) { create(:experience_highlight, experience: role, content: "Helped migrate services") }
  let(:queue) { double("queue", send_message: nil) }

  before do
    allow(Shoryuken::Client).to receive(:queues).and_return(queue)
  end

  def start_review
    execute_graphql(<<~GQL, user: user).dig("data", "reviewLibrarySection")
      mutation { reviewLibrarySection(input: {section: "experience"}) { aiTask { id status input } errors } }
    GQL
  end

  it "queues only owned Experience targets, reusing an active section review" do
    create(:project, user: user)
    create(:experience)
    payload = start_review
    expect(payload["errors"]).to eq([])
    expect(payload["aiTask"]["status"]).to eq("QUEUED")
    input = payload["aiTask"]["input"]
    expect(input["library"].keys).to eq(["experiences"])
    expect(input["library"]["experiences"].map { |record| record["id"] }).to eq([role.id])
    expect(input["targets"].map { |target| target["record_id"] }).to eq([role.id, highlight.id])
    expect(start_review["aiTask"]["id"]).to eq(payload["aiTask"]["id"])
    expect(queue).to have_received(:send_message).once
  end
end

RSpec.describe "Career library review results" do
  let(:user) { create(:user) }
  let!(:role) { create(:experience, user: user, description: "Built services") }
  let!(:highlight) { create(:experience_highlight, experience: role, content: "Helped migrate services") }
  let(:snapshot) { CareerLibrary::ReviewSnapshot.build(user: user, section: "experience") }
  let(:task) { create(:ai_task, user: user, task_type: "review_library_section", input: snapshot) }

  def result_for(task, color = "yellow")
    { "assessments" => task.input["targets"].map { |target| target.except("label").merge("color" => color, "reason" => "Explain your contribution.") } }
  end

  def apply(task, result = result_for(task))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => result })
  end

  def state(owner = user)
    execute_graphql(<<~GQL, user: owner).dig("data", "libraryReview")
      query { libraryReview(section: "experience") { aiTask { id status errorMessage } assessments { recordId color reason question questions stale } } }
    GQL
  end

  it "exposes saved questions with their assessed targets while old questionless results remain readable" do
    result = result_for(task)
    result["assessments"].last["question"] = "What did you personally do during the migration?"
    apply(task, result)

    grades = state["assessments"].index_by { |item| item["recordId"] }
    expect(grades[highlight.id]["question"]).to eq("What did you personally do during the migration?")
    expect(grades[highlight.id]["questions"]).to eq(["What did you personally do during the migration?"])
    expect(grades[role.id]["question"]).to be_nil
    expect(grades[role.id]["questions"]).to eq([])
    expect(highlight.reload.content).to eq("Helped migrate services")
  end

  it "exposes three questions together and retains the first for scalar clients" do
    questions = ["What did you personally do?", "How did you approach it?", "What changed afterward, if anything?"]
    result = result_for(task)
    result["assessments"].last["questions"] = questions
    apply(task, result)

    grade = state["assessments"].find { |item| item["recordId"] == highlight.id }
    expect(grade["questions"]).to eq(questions)
    expect(grade["question"]).to eq(questions.first)
  end

  [["One?", "Two?", "Three?", "Four?"], [""], ["  "], ["x" * 501], [123], "One?", ["What did you do?", " WHAT  did you do? "]].each do |questions|
    it "rejects malformed or repeated question sets (#{questions.inspect[0, 40]})" do
      result = result_for(task)
      result["assessments"].last["questions"] = questions
      apply(task, result)
      expect(task.reload.status).to eq("failed")
      expect(task.result).to be_nil
    end
  end

  it "rejects scalar and array questions that disagree" do
    result = result_for(task)
    result["assessments"].last.merge!("questions" => ["What did you do?"], "question" => "A different question?")
    apply(task, result)
    expect(task.reload.status).to eq("failed")
  end

  ["", "   ", "x" * 501, 123, ["What did you do?"]].each do |question|
    it "rejects malformed review questions (#{question.class}, length #{question.to_s.length})" do
      result = result_for(task)
      result["assessments"].last["question"] = question
      apply(task, result)
      expect(task.reload.status).to eq("failed")
      expect(task.result).to be_nil
    end
  end

  it "persists current grades and marks only changed role context stale" do
    other = create(:experience, user: user, description: "Delivered billing services")
    apply(task)
    expect(state["assessments"].map { |item| item["stale"] }).to eq([false, false, false])
    highlight.update!(content: "Migrated the billing API")
    grades = state["assessments"].index_by { |item| item["recordId"] }
    expect(grades[highlight.id]["stale"]).to be(true)
    expect(grades[role.id]["stale"]).to be(true)
    expect(grades[other.id]["stale"]).to be(false)
  end

  it "does not expose another user's review and does not resurrect deleted targets" do
    apply(task)
    expect(state(create(:user))["assessments"]).to eq([])
    highlight.destroy!
    expect(state["assessments"].map { |item| item["recordId"] }).to eq([role.id])
  end

  it "rejects unknown/duplicate targets and keeps the outcome on duplicate delivery" do
    invalid = result_for(task)
    invalid["assessments"][1] = invalid["assessments"][0]
    apply(task, invalid)
    expect(task.reload.status).to eq("failed")
    apply(task)
    expect(task.reload.status).to eq("failed")
    expect(task.result).to be_nil
  end

  it "does not approve changed snapshot text from a late screening report" do
    old = task
    role.update!(description: "New unchecked user details")
    AiTasks::ApplyAiResultService.call(message: {
      "ai_task_id" => old.id, "status" => "completed", "result" => result_for(old),
      "library_screening" => [
        { "record_type" => "experience", "record_id" => role.id, "fields" => %w[company description] },
        { "record_type" => "experience_highlight", "record_id" => highlight.id, "fields" => [ "content" ] }
      ]
    })
    expect(role.reload.screened_fields).to include("company")
    expect(role.screened_fields).not_to include("description")
    expect(highlight.reload.screened_fields).to include("content")
  end

  it "keeps the more recently requested grades when an older request finishes late" do
    older = task
    newer = create(:ai_task, user: user, task_type: "review_library_section", input: snapshot, created_at: 1.minute.from_now)
    apply(newer, result_for(newer, "green"))
    apply(older, result_for(older, "red"))
    expect(state["aiTask"]["id"]).to eq(newer.id)
    expect(state["assessments"].map { |item| item["color"] }).to eq(["green", "green"])
  end
end

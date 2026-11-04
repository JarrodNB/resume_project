# Saved dismissals retire review feedback without changing facts or requesting AI work.
require "rails_helper"

RSpec.describe "Career library review dismissal" do
  let(:user) { create(:user) }
  let!(:role) { create(:experience, user: user, description: "Built services") }
  let!(:highlight) { create(:experience_highlight, experience: role, content: "Helped migrate services") }
  let(:snapshot) { CareerLibrary::ReviewSources.build(user: user, section: "experience") }
  let!(:review) do
    create(:ai_task, user: user, task_type: "review_library_section", status: "completed",
      input: CareerLibrary::ReviewCommand.from_projection(snapshot), result: {
        "assessments" => snapshot["targets"].map { |target| target.merge("color" => "yellow", "reason" => "Explain your contribution.", "questions" => [ "What did you do?" ]) }
      })
  end

  def dismiss(scope = "questions", owner: user, task_id: review.id, record_id: highlight.id)
    execute_graphql(<<~GQL, user: owner).dig("data", "dismissLibraryReview")
      mutation { dismissLibraryReview(input: {reviewTaskId: "#{task_id}", kind: "experience_highlight", recordId: "#{record_id}", scope: "#{scope}"}) { errors } }
    GQL
  end

  def assessments
    execute_graphql('query { libraryReview(section: "experience") { assessments { recordId color questions reviewTaskId } } }', user: user).dig("data", "libraryReview", "assessments")
  end

  it "persists nothing-to-add without a draft, keeps the grade, and prevents new answers" do
    expect { expect(dismiss["errors"]).to eq([]) }.not_to change(AiTask, :count)
    expect(dismiss["errors"]).to eq([])
    item = assessments.find { |entry| entry["recordId"] == highlight.id }
    expect(item).to include("color" => "yellow", "questions" => [])
    expect(assessments.find { |entry| entry["recordId"] == role.id }["questions"]).to eq([ "What did you do?" ])
    answer = CareerLibrary::AnswerReviewService.call(user: user, review_task_id: review.id,
      kind: "experience_highlight", record_id: highlight.id, answer: "More context")
    expect(answer).not_to be_success
    expect(highlight.reload.content).to eq("Helped migrate services")
  end

  it "hides the assessment, keeps dismissal idempotent, and allows a new review" do
    expect(dismiss("review")["errors"]).to eq([])
    expect(dismiss["errors"]).to eq([])
    expect(assessments.map { |item| item["recordId"] }).to eq([ role.id ])
    create(:ai_task, user: user, task_type: "review_library_section", status: "completed",
      input: review.input, result: review.result.except("dismissed_assessments"))
    expect(assessments.find { |item| item["recordId"] == highlight.id }["questions"]).to eq([ "What did you do?" ])
    expect(dismiss("review")["errors"]).to include("This review is no longer current. Reload to see the latest feedback.")
  end

  it "rejects foreign reviews, foreign targets, invalid scopes, and changed sources" do
    expect(dismiss(owner: create(:user))["errors"]).to eq([ "Record not found" ])
    expect(dismiss(record_id: create(:experience_highlight).id)["errors"]).to eq([ "Record not found" ])
    expect(dismiss("anything")["errors"]).not_to be_empty
    highlight.update!(content: "Different contribution")
    expect(dismiss["errors"]).not_to be_empty
    expect(review.reload.result).not_to have_key("dismissed_assessments")
  end

  it "also dismisses the assessment produced by an accepted edit" do
    target = snapshot["targets"].last
    edit = create(:ai_task, user: user, task_type: "improve_library_entry", status: "completed",
      input: { "section" => "experience", "target" => target }, accepted_at: 1.second.from_now,
      result: { "assessment" => target.merge("color" => "green", "reason" => "Specific contribution.") })
    expect(assessments.find { |item| item["recordId"] == highlight.id }["reviewTaskId"]).to eq(edit.id)
    expect(dismiss("review", task_id: edit.id)["errors"]).to eq([])
    expect(assessments.map { |item| item["recordId"] }).to eq([ role.id ])
  end
end

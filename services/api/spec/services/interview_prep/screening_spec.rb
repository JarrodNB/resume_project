# Practice approvals are scoped to exact queued sources and current saved revisions.
require "rails_helper"
require "digest"
require "json"

RSpec.describe "Saved practice screening" do
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { question_set.questions.create!(position: 1, question_text: "Describe a challenge?", answer_text: "I led a team.", answer_revision: 1) }
  let(:snapshot) { question.attributes.slice("question_text", "answer_text", "question_revision", "answer_revision").merge("question_id" => question.id, "question_set_id" => question_set.id) }
  let(:task) { create(:ai_task, user: user, subject: question, task_type: "review_interview_answer", input: snapshot) }

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  def report(record = question, fields = %w[question_text answer_text])
    { "record_type" => "interview_question", "record_id" => record.id, "revision" => { "question_revision" => record.question_revision,
      "answer_revision" => record.answer_revision },
      "fingerprints" => fields.to_h { |field| [ field, Digest::SHA256.hexdigest(JSON.generate(record[field])) ] } }
  end

  def apply(reports, target: task, status: "failed")
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => target.id,
      "status" => status, "error_message" => "Generation failed", "record_screening" => reports })
  end

  it "retains actual checks when later generation fails" do
    expect(apply([ report ])).to be_success
    expect(question.reload.attributes["screened_fields"]).to match_array(%w[question_text answer_text])
  end

  it "clears only changed answer checks and rejects final redelivery" do
    reports = [ report ]
    expect(apply(reports)).to be_success
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: question.answer_text)).to be_success
    expect(question.reload.screened_fields).to match_array(%w[question_text answer_text])
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "Edited answer")).to be_success
    expect(question.reload.screened_fields).to eq([ "question_text" ])
    expect(apply(reports)).to be_success
    expect(question.reload.screened_fields).to eq([ "question_text" ])
  end

  it "requires exact field revisions even after edit and revert, retaining the unchanged question" do
    reports = [ report ]
    task
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "Edited")
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: snapshot["answer_text"])
    expect(apply(reports)).to be_success
    expect(question.reload.screened_fields).to eq([ "question_text" ])
  end

  it "rejects replaced question revisions even when old text is restored" do
    reports = [ report ]
    task
    question.update!(question_revision: question.question_revision + 1)
    expect(apply(reports)).to be_success
    expect(question.reload.screened_fields).to be_empty
  end

  it "matches the task snapshot as well as current values" do
    task
    question.update!(answer_text: "Newer answer")
    expect(apply([ report ])).to be_success
    expect(question.reload.screened_fields).to eq([ "question_text" ])
  end

  it "ignores unsupported, malformed, foreign and wrong-source reports" do
    other_set = user.interview_question_sets.create!(number: 2)
    other = other_set.questions.create!(position: 1, question_text: question.question_text)
    stranger = create(:user).interview_question_sets.create!(number: 1).questions.create!(position: 1, question_text: question.question_text)
    bad = report
    bad["fingerprints"] = { "feedback" => "a" * 64, "question_text" => nil }
    expect(apply([ nil, {}, bad, report(other, [ "question_text" ]), report(stranger, [ "question_text" ]),
      { "question_id" => question.id, "fingerprints" => [] } ])).to be_success
    [ question, other, stranger ].each { |record| expect(record.reload.screened_fields).to be_empty }
  end

  it "ignores wrong task/set identities and usage-only results" do
    reports = [ report ]
    task.update!(input: snapshot.merge("question_set_id" => SecureRandom.uuid))
    expect(apply(reports)).to be_success
    other_task = create(:ai_task, user: user, subject: question, input: snapshot)
    expect(apply(reports, target: other_task)).to be_success
    usage_task = create(:ai_task, user: user, subject: question, task_type: "review_interview_answer", input: snapshot)
    expect(AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => usage_task.id,
      "status" => "usage", "attempt_id" => SecureRandom.uuid, "record_screening" => reports })).to be_success
    expect(question.reload.screened_fields).to be_empty
  end

  it "ignores deleted targets" do
    reports = [ report ]
    task
    question.destroy!
    expect(apply(reports)).to be_success
  end

  it "does not persist invalid answer changes or their check invalidation" do
    expect(apply([ report ])).to be_success
    before = question.reload.attributes
    expect(InterviewPrep::SaveAnswerService.call(question: question, answer_text: "x" * (TextLimits::INTERVIEW_ANSWER + 1))).not_to be_success
    expect(question.reload.attributes).to eq(before)
  end

  it "snapshots every sibling identity while preserving legacy text fields" do
    peers = (2..5).map { |position| question_set.questions.create!(position: position, question_text: "Peer #{position}?") }
    question.update!(screened_fields: %w[question_text answer_text])
    queue = instance_double(Shoryuken::Queue, send_message: nil)
    allow(Shoryuken::Client).to receive(:queues).and_return(queue)
    result = InterviewPrep::StartQuestionTaskService.call(user: user, question: question,
      task_type: "regenerate_interview_question", confirmed: true)
    expect(result).to be_success
    input = result.value.input
    expect(input["screened_fields"]).to match_array(%w[question_text answer_text])
    expect(input["other_questions"]).to eq(peers.map(&:question_text))
    expect(input["other_question_snapshots"].map { |peer| peer["question_id"] }).to eq(peers.map(&:id))
    expect(input["other_question_snapshots"].map { |peer| peer["question_text"] }).to eq(input["other_questions"])
  end

  it "records every aligned sibling but never its unused answer" do
    peers = (2..5).map { |position| question_set.questions.create!(position: position, question_text: "Same peer?", answer_text: "Not used") }
    task.update!(task_type: "regenerate_interview_question", input: snapshot.merge(
      "other_questions" => peers.map(&:question_text),
      "other_question_snapshots" => peers.map { |peer| {
        "question_id" => peer.id, "question_set_id" => question_set.id, "question_text" => peer.question_text,
        "question_revision" => peer.question_revision, "answer_text" => peer.answer_text, "answer_revision" => peer.answer_revision
      } }))
    expect(apply([ report, *peers.map { |peer| report(peer) } ])).to be_success
    [ question, *peers ].each { |record| expect(record.reload.screened_fields).to eq([ "question_text" ]) }
  end

  %i[text set revision legacy duplicate].each do |problem|
    it "rejects #{problem} sibling provenance without approving unrelated fields" do
      peers = (2..5).map { |position| question_set.questions.create!(position: position, question_text: "Peer #{position}?") }
      sources = peers.map { |peer| { "question_id" => peer.id, "question_set_id" => question_set.id,
        "question_text" => peer.question_text, "question_revision" => peer.question_revision } }
      reports = peers.map { |peer| report(peer, [ "question_text" ]) }
      case problem
      when :text then sources[0]["question_text"] = "Different snapshot text"
      when :set then sources[0]["question_set_id"] = SecureRandom.uuid
      when :revision then peers[0].update!(question_revision: 2)
      when :legacy then sources = []
      when :duplicate then sources[1]["question_id"] = sources[0]["question_id"]
      end
      task.update!(task_type: "regenerate_interview_question", input: snapshot.merge(
        "other_questions" => peers.map(&:question_text), "other_question_snapshots" => sources))
      expect(apply(reports)).to be_success
      expect(peers.first.reload.screened_fields).to be_empty
      peers.drop(1).each do |record|
        expect(record.reload.screened_fields).to eq(%i[legacy duplicate].include?(problem) ? [] : [ "question_text" ])
      end
    end
  end

  it "starts saved questions unchecked and shares Unicode fingerprint vectors" do
    expect(question.screened_fields).to be_empty
    JSON.parse(File.read(Rails.root.join("../ai/tests/fixtures/job_field_fingerprints.json"))).each do |vector|
      expect(Screening::RecordApprovalsService.field_fingerprint(vector["value"])).to eq(vector["sha256"])
    end
  end
end

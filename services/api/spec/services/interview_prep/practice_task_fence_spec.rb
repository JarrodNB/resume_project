# Description: Pins the practice-task fence against the cases shared with the Python source reader.
# Index:
#   - shared cases: every case in practice_task_fence_cases.json, checked for the Rails (apply-time) answer
#   - build_command: the commands Start queues match the fixture's base commands
require "rails_helper"

RSpec.describe InterviewPrep::PracticeTaskFence do
  fixture = JSON.parse(File.read(Rails.root.join("../ai/tests/fixtures/practice_task_fence_cases.json")))
  let(:fixture) { fixture }
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }

  # Saves the fixture's base rows plus a case's overrides; returns the set and questions by key.
  def save_rows(state_changes = {})
    state = fixture["base_state"]
    set_row = state["set"].merge(state_changes["set"] || {})
    question_set = user.interview_question_sets.create!(number: set_row["number"], set_type: set_row["set_type"], origin: set_row["origin"])
    questions = {}
    unless state_changes["no_questions"]
      state["questions"].each_with_index do |(key, row), index|
        changes = (state_changes["questions"] || {}).fetch(key, {})
        next if changes.nil? && state_changes["questions"].key?(key)

        row = row.merge(changes)
        retired = row.delete("retired")
        questions[key] = question_set.questions.create!(
          row.merge(question_text: "Question #{key}?", position: index + 1).symbolize_keys
        ).tap { |question| question.update_columns(position: nil, retired_at: Time.current) if retired }
      end
    end
    [ question_set, questions ]
  end

  # Replaces "@set" / "@qN" placeholders (in keys and values) with saved ids.
  def resolve(value, ids)
    case value
    when Hash then value.to_h { |key, inner| [ resolve(key, ids), resolve(inner, ids) ] }
    when String then ids.fetch(value, value)
    else value
    end
  end

  def ids_for(question_set, questions)
    questions.transform_keys { |key| "@#{key}" }.transform_values(&:id).merge("@set" => question_set.id)
  end

  fixture["cases"].each do |shared_case|
    it "agrees with the shared case: #{shared_case['name']}" do
      question_set, questions = save_rows(shared_case)
      ids = ids_for(question_set, questions)
      command = resolve(fixture["base_commands"].fetch(shared_case["task_type"]), ids)
      (shared_case["command_changes"] || {}).each { |key, value| value.nil? ? command.delete(key) : command[key] = value }
      subject = shared_case["task_type"] == "generate_interview_questions" ? question_set : questions["q1"]
      subject = questions[shared_case["subject"]] if shared_case["subject"]
      owner = shared_case["task_owner"] == "other_user" ? other_user : user
      task = create(:ai_task, user: owner, task_type: shared_case["task_type"], subject: subject, input: command,
                              status: shared_case["task_status"] || "queued", created_at: 1.minute.ago)
      create(:ai_task, user: owner, task_type: shared_case["task_type"], subject: subject, input: command) if shared_case["newer_task"]

      expected = shared_case["expect"]["rails"]
      expect(described_class.stale_reason(task)).to eq(expected == "current" ? nil : expected.to_sym)
    end
  end

  # Start builds commands only through the fence, so these must stay equal to the fixture's base commands.
  describe ".build_command" do
    it "builds the same commands the shared cases start from" do
      question_set, questions = save_rows
      ids = ids_for(question_set, questions)
      (fixture["base_commands"].keys - [ "generate_interview_questions" ]).each do |task_type|
        expect(described_class.build_command(task_type: task_type, subject: questions["q1"]))
          .to eq(resolve(fixture["base_commands"][task_type], ids))
      end
      expect(described_class.build_command(task_type: "generate_interview_questions", subject: question_set, set_number: 1))
        .to eq(resolve(fixture["base_commands"]["generate_interview_questions"], ids))
    end

    it "rejects unknown task types" do
      question_set, = save_rows
      expect { described_class.build_command(task_type: "analyze_gaps", subject: question_set) }.to raise_error(ArgumentError)
    end
  end

  # The fence keeps nothing between calls, so a loop over tasks sees each task's own rows.
  it "judges each task on its own rows when called repeatedly" do
    question_set, questions = save_rows
    command = resolve(fixture["base_commands"]["review_interview_answer"], ids_for(question_set, questions))
    first = create(:ai_task, user: user, task_type: "review_interview_answer", subject: questions["q1"], input: command)
    second_set, second_questions = save_rows("set" => { "number" => 2 })
    second_command = resolve(fixture["base_commands"]["review_interview_answer"], ids_for(second_set, second_questions))
    second = create(:ai_task, user: user, task_type: "review_interview_answer", subject: second_questions["q1"], input: second_command)
    second_questions["q1"].update!(question_revision: 2)

    expect(described_class.stale_reason(first)).to be_nil
    expect(described_class.stale_reason(second)).to eq(:revision_changed)
    expect(described_class.stale_reason(first)).to be_nil
  end
end

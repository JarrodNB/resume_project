# Checks that chosen length survives preparation, claims and replay without changing old sessions.
require "rails_helper"

RSpec.describe "Interview setup configuration" do
  let(:user) { create(:user, summary: "I maintain laboratory instruments.") }

  it "freezes a selected screening format and accepts only screening questions" do
    result = Interviews::StartPreparationService.call(user: user, setup: { question_count: 5, question_format: "screening" })
    expect(result).to be_success
    interview = result.value
    operation = interview.operations.first
    claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
    expect(claim.value.dig(:payload, :setup)).to eq("question_count" => 5, "question_format" => "screening")
    role = { "title" => "Laboratory technician", "responsibilities" => [ "Maintain instruments" ], "requirements" => [ "Calibration" ] }
    questions = 5.times.map { |i| { "question_type" => "screening", "content" => "Screening question #{i}?" } }
    accept = ->(items) { Interviews::AcceptPreparationService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, role: role, questions: items) }
    wrong = questions.map(&:dup)
    wrong[0]["question_type"] = "behavioral"
    expect(accept.call(wrong)).not_to be_success
    expect(interview.questions).to be_empty
    expect(accept.call(questions)).to be_success
    expect(interview.questions.pluck(:question_type)).to eq([ "screening" ] * 5)
  end

  it "defaults new preparations to eight main questions and rejects unsupported lengths before saving" do
    [ { question_count: 6 }, { question_count: 9 }, { question_count: 8.0 }, { question_count: "8" },
      { question_count: 8, extra: true }, "invalid", [ 8 ] ].each do |setup|
      expect(Interviews::StartPreparationService.call(user: user, setup: setup)).not_to be_success
    end
    expect(user.interview_sessions).to be_empty
    interview = Interviews::StartPreparationService.call(user: user).value
    expect(interview.reload.setup_config).to eq("question_count" => 8, "question_format" => "mixed")
    claim = Interviews::ClaimOperationService.call(operation: interview.operations.first, execution_mode: "real")
    expect(claim.value.fetch(:payload).fetch(:setup)).to eq("question_count" => 8, "question_format" => "mixed")
  end

  it "retains the selected setup when a failed preparation is explicitly retried" do
    interview = Interviews::StartPreparationService.call(user: user, setup: { question_count: 12 }).value
    operation = interview.operations.first
    operation.update!(status: "failed", failure_code: "dependency_unavailable", retry_at: nil,
      cycle_execution_count: 3, retry_expires_at: 1.hour.from_now)
    expect(Interviews::RetryOperationService.call(operation: operation)).to be_success
    claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
    expect(claim).to be_success
    expect(claim.value.dig(:payload, :setup)).to eq("question_count" => 12, "question_format" => "mixed")
  end

  [ 5, 8, 12 ].each do |count|
    it "accepts exactly #{count} saved main questions once and rejects changed output" do
      interview = Interviews::StartPreparationService.call(user: user, setup: { question_count: count }).value
      operation = interview.operations.first
      expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
      role = { "title" => "Laboratory technician", "responsibilities" => [ "Maintain instruments" ], "requirements" => [ "Calibration" ] }
      questions = count.times.map { |i| { "question_type" => %w[behavioral technical knowledge][i % 3], "content" => "Laboratory question #{i}?" } }
      accept = ->(items) { Interviews::AcceptPreparationService.call(operation: operation, attempt_id: operation.attempt_id,
        claim_generation: operation.claim_generation, role: role, questions: items) }
      expect(accept.call(questions.first(count - 1))).not_to be_success
      wrong_type = questions.map(&:dup)
      wrong_type[0]["question_type"] = "technical"
      expect(accept.call(wrong_type)).not_to be_success
      duplicates = questions.map(&:dup)
      duplicates[-1]["content"] = duplicates.first["content"]
      expect(accept.call(duplicates)).not_to be_success
      expect(interview.questions).to be_empty
      first = accept.call(questions)
      expect(first).to be_success
      expect(accept.call(questions).value).to eq(first.value)
      expect(interview.questions.count).to eq(count)
      expect(interview.reload.setup_config).to eq("question_count" => count, "question_format" => "mixed")
      expect { interview.update!(setup_config: { "question_count" => 5 }) }.to raise_error(ActiveRecord::ReadonlyAttributeError)
    end
  end

  { "mixed" => %w[behavioral technical knowledge], "behavioral" => %w[behavioral],
    "technical" => %w[technical knowledge], "screening" => %w[screening] }.each do |format, cycle|
    [ 5, 8, 12 ].each do |count|
      it "prepares #{count} questions in the #{format} format and rejects another sequence" do
        result = Interviews::StartPreparationService.call(user: user, setup: { question_count: count, question_format: format })
        expect(result).to be_success
        interview = result.value
        operation = interview.operations.first
        claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
        expect(claim.value.dig(:payload, :setup)).to eq("question_count" => count, "question_format" => format)
        role = { "title" => "Laboratory technician", "responsibilities" => [ "Maintain instruments" ], "requirements" => [ "Calibration" ] }
        questions = count.times.map { |i| { "question_type" => cycle[i % cycle.size], "content" => "Laboratory question #{i}?" } }
        accept = ->(items) { Interviews::AcceptPreparationService.call(operation: operation, attempt_id: operation.attempt_id,
          claim_generation: operation.claim_generation, role: role, questions: items) }
        wrong = questions.map(&:dup)
        wrong[0]["question_type"] = format == "screening" ? "behavioral" : "screening"
        expect(accept.call(wrong)).not_to be_success
        if cycle.size > 1
          reordered = questions.map(&:dup)
          reordered[0]["question_type"], reordered[1]["question_type"] = reordered[1]["question_type"], reordered[0]["question_type"]
          expect(accept.call(reordered)).not_to be_success
        end
        expect(interview.questions).to be_empty
        expect(accept.call(questions)).to be_success
        expect(accept.call(questions)).to be_success
        expect(interview.questions.pluck(:question_type)).to eq(questions.pluck("question_type"))
        expect(interview.reload.setup_config).to eq("question_count" => count, "question_format" => format)
      end
    end
  end

  it "rejects unsupported formats before saving and keeps length-only saved sessions mixed" do
    [ "unknown", "", nil, 1, [] ].each do |format|
      expect(Interviews::StartPreparationService.call(user: user,
        setup: { question_count: 5, question_format: format })).not_to be_success
    end
    expect(user.interview_sessions).to be_empty
    interview = Interviews::StartPreparationService.call(user: user, setup: { question_count: 5 }).value
    InterviewSession.where(id: interview.id).update_all(setup_config: { "question_count" => 5 })
    claim = Interviews::ClaimOperationService.call(operation: interview.operations.first, execution_mode: "real")
    expect(claim.value.dig(:payload, :setup)).to eq("question_count" => 5, "question_format" => "mixed")
    expect(Interviews::SetupConfiguration.question_types(interview.reload)).to eq(%w[behavioral technical knowledge behavioral technical])
  end
end

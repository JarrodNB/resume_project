# Checks the shared recorder that saves screening approvals for every saved record type.
require "rails_helper"
require "digest"
require "json"

RSpec.describe Screening::RecordApprovalsService do
  let(:user) { create(:user, summary: "I build tools.") }

  def fingerprint(value)
    Digest::SHA256.hexdigest(JSON.generate(value))
  end

  def receipt(record_type, record, fields, revision: nil)
    { "record_type" => record_type, "record_id" => record.id,
      "fingerprints" => fields.to_h { |field| [ field, fingerprint(record[field]) ] },
      "revision" => revision }.compact
  end

  def record(reports, ai_task: nil, owner: user)
    described_class.call(user: owner, reports: reports, ai_task: ai_task)
  end

  describe "career library" do
    it "approves each library type when the fingerprint matches, idempotently" do
      experience = create(:experience, user: user)
      records = { "user" => user, "experience" => experience,
                  "experience_highlight" => create(:experience_highlight, experience: experience),
                  "project" => create(:project, user: user), "education" => create(:education, user: user),
                  "certification" => create(:certification, user: user), "skill" => create(:skill, user: user),
                  "career_context" => create(:career_context, user: user) }
      reports = records.map { |type, item| receipt(type, item, described_class::RECORD_TYPES.fetch(type)[:fields]) }
      2.times { expect(record(reports)).to be_success }
      records.each do |type, item|
        expect(item.reload.screened_fields).to match_array(described_class::RECORD_TYPES.fetch(type)[:fields])
      end
    end

    it "ignores stale fingerprints, missing fingerprints and unlisted fields" do
      skill = create(:skill, user: user, name: "Ruby", category: "Languages")
      reports = [
        receipt("skill", skill, [ "name" ]).merge("fingerprints" => { "name" => fingerprint("Python") }),
        { "record_type" => "skill", "record_id" => skill.id, "fingerprints" => {} },
        { "record_type" => "skill", "record_id" => skill.id, "fields" => [ "category" ] },
        { "record_type" => "skill", "record_id" => skill.id, "fingerprints" => { "position" => fingerprint(skill.position) } }
      ]
      expect(record(reports)).to be_success
      expect(skill.reload.screened_fields).to eq([])
    end

    it "does not approve text edited after the fingerprint was taken" do
      project = create(:project, user: user, name: "Old name")
      report = receipt("project", project, [ "name" ])
      Projects::UpdateProjectService.call(project: project, attributes: { name: "New name" })
      expect(record([ report ])).to be_success
      expect(project.reload.screened_fields).to eq([])
    end

    it "ignores foreign, deleted, unknown and malformed receipts" do
      foreign = create(:skill, name: "Ruby")
      foreign_highlight = create(:experience_highlight)
      other_user = create(:user, summary: "Private")
      deleted = create(:skill, user: user)
      deleted_report = receipt("skill", deleted, [ "name" ])
      deleted.destroy!
      skill = create(:skill, user: user)
      reports = [
        receipt("skill", foreign, [ "name" ]), receipt("experience_highlight", foreign_highlight, [ "content" ]),
        receipt("user", other_user, [ "summary" ]), deleted_report,
        receipt("resume", skill, [ "name" ]), receipt("Skill", skill, [ "name" ]),
        nil, "skill", {}, { "record_type" => "skill" },
        { "record_type" => "skill", "record_id" => skill.id, "fingerprints" => [ fingerprint(skill.name) ] },
        receipt("skill", skill, [ "name" ]).merge("record_id" => nil),
        receipt("skill", skill, [ "name" ]).merge("revision" => "1"),
        receipt("skill", skill, [ "name" ]).merge("fingerprints" => { "name" => fingerprint(skill.name).upcase })
      ]
      expect(record("not a list")).to be_success
      expect(record(reports)).to be_success
      [ foreign, foreign_highlight, other_user, skill ].each { |item| expect(item.reload.screened_fields).to eq([]) }
    end
  end

  describe "jobs" do
    let(:job) { create(:job, user: user) }
    let(:task) { create(:ai_task, user: user, subject: job, task_type: "analyze_gaps") }

    it "approves only the task's own job for gap analysis and tailoring" do
      other_job = create(:job, user: user)
      expect(record([ receipt("job", job, %w[title company]), receipt("job", other_job, [ "title" ]) ], ai_task: task)).to be_success
      expect(job.reload.screened_fields).to match_array(%w[title company])
      expect(other_job.reload.screened_fields).to eq([])
    end

    it "needs a matching task type, task owner and subject" do
      report = receipt("job", job, [ "title" ])
      record([ report ])
      record([ report ], ai_task: create(:ai_task, user: user, subject: job, task_type: "scrape_job"))
      record([ report ], ai_task: task, owner: create(:user))
      record([ report ], ai_task: create(:ai_task, user: user, subject: create(:job, user: user), task_type: "tailor_resume"))
      expect(job.reload.screened_fields).to eq([])
    end
  end

  describe "gap responses" do
    let(:job) { create(:job, user: user) }
    let(:response) { create(:job_gap_response, job: job) }
    let(:task) do
      create(:ai_task, user: user, subject: job, task_type: "tailor_resume", input: {
        "gap_responses" => [ response.attributes.slice("id", "requirement", "body") ]
      })
    end

    it "approves snapshotted answers that still match" do
      expect(record([ receipt("gap_response", response, %w[requirement body]) ], ai_task: task)).to be_success
      expect(response.reload.screened_fields).to match_array(%w[requirement body])
    end

    it "rejects answers edited after queueing and answers missing from the snapshot" do
      task
      unsnapshotted = create(:job_gap_response, job: job, requirement: "Not in snapshot")
      response.update!(body: "Edited after queueing")
      reports = [ receipt("gap_response", response, %w[requirement body]), receipt("gap_response", unsnapshotted, [ "body" ]) ]
      expect(record(reports, ai_task: task)).to be_success
      expect(response.reload.screened_fields).to eq([ "requirement" ])
      expect(unsnapshotted.reload.screened_fields).to eq([])
    end

    it "only accepts tailoring tasks" do
      analysis = create(:ai_task, user: user, subject: job, task_type: "analyze_gaps", input: task.input)
      expect(record([ receipt("gap_response", response, [ "body" ]) ], ai_task: analysis)).to be_success
      expect(response.reload.screened_fields).to eq([])
    end
  end

  describe "interview questions" do
    let(:question_set) { user.interview_question_sets.create!(number: 1) }
    let(:question) do
      question_set.questions.create!(position: 1, question_text: "Describe a challenge?", answer_text: "I led a team.", answer_revision: 1)
    end
    let(:snapshot) do
      question.attributes.slice("question_text", "answer_text", "question_revision", "answer_revision")
        .merge("question_id" => question.id, "question_set_id" => question_set.id)
    end
    let(:task) { create(:ai_task, user: user, subject: question, task_type: "review_interview_answer", input: snapshot) }

    def question_receipt(item = question, fields = %w[question_text answer_text])
      receipt("interview_question", item, fields,
        revision: { "question_revision" => item.question_revision, "answer_revision" => item.answer_revision })
    end

    it "approves the reviewed question and answer at their frozen revisions" do
      expect(record([ question_receipt ], ai_task: task)).to be_success
      expect(question.reload.screened_fields).to match_array(%w[question_text answer_text])
    end

    it "rejects a wrong answer or question revision" do
      report = question_receipt
      task
      InterviewPrep::SaveAnswerService.call(question: question, answer_text: "Edited")
      InterviewPrep::SaveAnswerService.call(question: question, answer_text: snapshot["answer_text"])
      expect(record([ report ], ai_task: task)).to be_success
      expect(question.reload.screened_fields).to eq([ "question_text" ])

      question.update!(screened_fields: [])
      wrong = report.merge("revision" => report["revision"].merge("question_revision" => question.question_revision + 1))
      expect(record([ wrong, report.except("revision") ], ai_task: task)).to be_success
      expect(question.reload.screened_fields).to eq([])
    end

    it "matches the task snapshot as well as the current value" do
      task
      question.update!(answer_text: "Newer answer")
      expect(record([ question_receipt ], ai_task: task)).to be_success
      expect(question.reload.screened_fields).to eq([ "question_text" ])
    end

    it "ignores questions outside the task's set" do
      other_set = user.interview_question_sets.create!(number: 2)
      other = other_set.questions.create!(position: 1, question_text: question.question_text)
      expect(record([ question_receipt(other, [ "question_text" ]) ], ai_task: task)).to be_success
      expect(other.reload.screened_fields).to eq([])
    end
  end
end

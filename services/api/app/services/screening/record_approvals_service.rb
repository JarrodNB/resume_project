# Remembers which fields of saved records the AI worker has already screened, so later
# workflows can skip checking the same text again. No screening happens here.
#
# The worker sends one receipt per record: its type, its id, a SHA-256 fingerprint of each
# field it checked and, for interview answers, the revisions it read. A field is approved
# only when its fingerprint matches the record's current value under the record's row lock
# and, for types that freeze text in the task input, the frozen value too. Unknown types,
# other users' records, deleted rows, edited text, wrong revisions and malformed receipts
# are quietly ignored, because a late or repeated result must never approve new text.
require "digest"
require "json"

module Screening
  class RecordApprovalsService < ApplicationService
    FINGERPRINT_FORMAT = /\A[0-9a-f]{64}\z/

    # One row per record type the worker may report.
    #   model:  the ActiveRecord class
    #   fields: the only fields that can be approved; models list their own through the
    #           ScreenedFields concern
    #   scope:  private method returning where records may come from for this call, plus
    #           any frozen task values; nil means this call can approve none of this type
    #   check:  optional private method with one more per-field rule
    # Types are processed in this order (task-bound types first, then the career library),
    # which keeps the lock order the older recorders used.
    RECORD_TYPES = {
      # Practice questions clear approvals through revisions, so the list lives here.
      "interview_question" => { model: InterviewQuestion, fields: %w[question_text answer_text].freeze,
                                scope: :interview_question_scope, check: :interview_revision_matches? },
      "job" => { model: Job, scope: :job_scope },
      "gap_response" => { model: JobGapResponse, scope: :gap_response_scope },
      "user" => { model: User, scope: :library_scope },
      "experience" => { model: Experience, scope: :library_scope },
      "experience_highlight" => { model: ExperienceHighlight, scope: :library_scope },
      "project" => { model: Project, scope: :library_scope },
      "education" => { model: Education, scope: :library_scope },
      "certification" => { model: Certification, scope: :library_scope },
      "skill" => { model: Skill, scope: :library_scope },
      "career_context" => { model: CareerContext, scope: :library_scope }
    }.transform_values { |entry| { fields: entry[:fields] || entry[:model].screened_field_names }.merge(entry).freeze }.freeze

    LIBRARY_TYPES = RECORD_TYPES.select { |_, entry| entry[:scope] == :library_scope }.keys.freeze

    # Matches Python's compact UTF-8 JSON encoding, without Rails HTML escaping.
    def self.field_fingerprint(value)
      Digest::SHA256.hexdigest(JSON.generate(value))
    end

    # @param user [User] owner of every record that may be approved
    # @param reports [Array<Hash>] receipts with record_type, record_id, fingerprints and optional revision
    # @param ai_task [AiTask, nil] needed for job, gap_response and interview_question receipts
    def initialize(user:, reports:, ai_task: nil)
      @user, @reports, @ai_task = user, reports, ai_task
    end

    # @return [ServiceResult] always succeeds; receipts that fail a rule are skipped.
    def call
      return success(nil) unless @reports.is_a?(Array)

      receipts = @reports.select { |receipt| well_formed?(receipt) }
      RECORD_TYPES.each do |record_type, entry|
        of_type = receipts.select { |receipt| receipt["record_type"] == record_type }
        next if of_type.empty?

        scope = send(entry[:scope], record_type)
        next unless scope

        # Sorted ids give every caller the same lock order.
        of_type.group_by { |receipt| receipt["record_id"] }.sort.each do |record_id, record_receipts|
          approve_record(entry, scope, record_id, record_receipts)
        end
      end
      success(nil)
    end

    private

    def well_formed?(receipt)
      receipt.is_a?(Hash) && RECORD_TYPES.key?(receipt["record_type"]) && receipt["record_id"].is_a?(String) &&
        receipt["fingerprints"].is_a?(Hash) && receipt["fingerprints"].any? &&
        (receipt["revision"].nil? || receipt["revision"].is_a?(Hash))
    end

    def approve_record(entry, scope, record_id, receipts)
      snapshot = nil
      if scope[:snapshots]
        snapshot = scope[:snapshots][record_id]
        return unless snapshot
      end
      record = scope[:records].find_by(id: record_id)
      return unless record

      record.with_lock do
        fields = receipts.flat_map { |receipt| approved_fields(entry, scope, record, snapshot, receipt) }
        combined = record.screened_fields | fields
        record.update!(screened_fields: combined) if combined != record.screened_fields
      end
    rescue ActiveRecord::RecordNotFound
      # A record deleted after lookup cannot receive an approval.
      nil
    end

    def approved_fields(entry, scope, record, snapshot, receipt)
      receipt["fingerprints"].filter_map do |field, fingerprint|
        next unless entry[:fields].include?(field) && fingerprint.is_a?(String) && fingerprint.match?(FINGERPRINT_FORMAT)
        next unless fingerprint == self.class.field_fingerprint(record[field])
        next if snapshot && !(snapshot[field].is_a?(String) && fingerprint == self.class.field_fingerprint(snapshot[field]))
        next if entry[:check] && !send(entry[:check], scope: scope, record: record, snapshot: snapshot, receipt: receipt, field: field)

        field
      end
    end

    def task_for_user?
      @ai_task && @ai_task.user_id == @user.id
    end

    # Career library entries need no task; ownership is the only rule.
    def library_scope(record_type)
      records = case record_type
      when "user" then User.where(id: @user.id)
      when "experience_highlight" then ExperienceHighlight.joins(:experience).where(experiences: { user_id: @user.id })
      else @user.public_send(record_type.pluralize)
      end
      { records: records }
    end

    # Only the job a gap analysis or tailoring task is about.
    def job_scope(_record_type)
      return unless task_for_user? && @ai_task.subject_type == "Job" && %w[analyze_gaps tailor_resume].include?(@ai_task.task_type)

      { records: @user.jobs.where(id: @ai_task.subject_id) }
    end

    # Only answers on the tailoring task's job that were frozen into the task input.
    def gap_response_scope(_record_type)
      return unless task_for_user? && @ai_task.task_type == "tailor_resume" && @ai_task.subject_type == "Job"

      job = @user.jobs.find_by(id: @ai_task.subject_id)
      return unless job

      snapshots = Array(@ai_task.input["gap_responses"]).each_with_object({}) do |item, by_id|
        by_id[item["id"]] ||= item if item.is_a?(Hash) && item["id"].is_a?(String)
      end
      { records: job.gap_responses, snapshots: snapshots }
    end

    # Only the task's question and, for regeneration, the sibling questions it froze.
    def interview_question_scope(_record_type)
      return unless task_for_user? && @ai_task.subject_type == "InterviewQuestion" &&
        %w[review_interview_answer regenerate_interview_question].include?(@ai_task.task_type)

      input = @ai_task.input
      set = @user.interview_question_sets.find_by(id: input["question_set_id"])
      return unless set && set.set_type == input.fetch("set_type", "general")

      target = set.questions.find_by(id: @ai_task.subject_id)
      return unless target && target.id == input["question_id"]

      { records: set.questions, snapshots: interview_sources(set, target, input), target_id: target.id }
    end

    def interview_sources(set, target, input)
      sources = { target.id => input }
      return sources unless @ai_task.regenerate_interview_question?

      peers, texts = input["other_question_snapshots"], input["other_questions"]
      return sources unless peers.is_a?(Array) && texts.is_a?(Array) && peers.length == texts.length

      ids = peers.filter_map { |peer| peer["question_id"] if peer.is_a?(Hash) }
      return sources unless ids.length == peers.length && ids.uniq.length == ids.length && !ids.include?(target.id)

      peers.zip(texts).each do |peer, text|
        next unless peer["question_set_id"] == set.id && peer["question_text"] == text && peer["question_id"].is_a?(String)

        sources[peer["question_id"]] = peer
      end
      sources
    end

    # The question must still be at the frozen revision. An answer is approved only on the
    # reviewed question itself, during answer review, at the frozen answer revision.
    def interview_revision_matches?(scope:, record:, snapshot:, receipt:, field:)
      revision = receipt["revision"] || {}
      question_revision = snapshot["question_revision"]
      return false unless question_revision.is_a?(Integer) && revision["question_revision"] == question_revision &&
        record.question_revision == question_revision
      return true unless field == "answer_text"

      answer_revision = snapshot["answer_revision"]
      record.id == scope[:target_id] && @ai_task.review_interview_answer? && answer_revision.is_a?(Integer) &&
        revision["answer_revision"] == answer_revision && record.answer_revision == answer_revision
    end
  end
end

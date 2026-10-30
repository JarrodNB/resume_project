# Remembers which fields of saved records the AI worker has already screened, so later
# workflows can skip checking the same text again. No screening happens here.
#
# The worker sends one receipt per record: its type, its id, a SHA-256 fingerprint of each
# field it checked and, for interview answers, the revisions it read. A field is approved
# only when its fingerprint matches the record's current value under the record's row lock
# and, for types that freeze text in the task input, the frozen value too. Unknown types,
# other users' records, deleted rows, edited text, wrong revisions and malformed receipts
# are quietly ignored, because a late or repeated result must never approve new text.
#
# Spoken interviews use `record_interview_sources`: the caller fingerprints the frozen values
# it screened, and only career library records plus the interview's own saved job qualify.
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
      "job_preference_criterion" => { model: JobPreferenceProfile, fields: %w[text].freeze,
        scope: :preference_scope, approve: :approve_preference_criterion },
      "job_board_listing" => { model: JobBoardListing, fields: %w[passages].freeze,
        scope: :preference_scope, approve: :approve_preference_listing },
      "interview_question" => { model: InterviewQuestion,
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

    # Approves live records for a spoken interview's screened frozen sources. Call it while
    # the interview operation lock is held, so that lock is always taken before record locks.
    # Jobs qualify only when they are the interview's own saved job; no task-bound types do.
    # @param interview [InterviewSession] whose owner and saved job bound the approvals
    # @param reports [Array<Hash>] receipts fingerprinting the frozen screened values
    # @return [ServiceResult] always succeeds; receipts that fail a rule are skipped.
    def self.record_interview_sources(interview:, reports:)
      new(user: interview.user, reports: reports, interview: interview).call
    end

    # Retired preference conversations cannot emit new receipts. Preserve their exact
    # successful input checks by importing them into the ordinary fingerprint store.
    # Current preference checks never infer approval from previous check-task inputs.
    def self.import_legacy_preference_checks(user:, profile:)
      return unless profile.user_id == user.id

      profile.with_lock do
        historical = user.ai_tasks.where(task_type: "elicit_job_preferences", status: %w[completed needs_user_input])
        fingerprints = profile.confirmed_criteria.filter_map do |criterion|
          text = criterion["text"]
          fingerprint = field_fingerprint(text)
          next if profile.screened_criteria_sha256.include?(fingerprint)
          next unless historical.where("input @> ?", { criteria: [ { text: text } ] }.to_json).exists?

          fingerprint
        end
        combined = profile.screened_criteria_sha256 | fingerprints
        profile.update!(screened_criteria_sha256: combined) if combined != profile.screened_criteria_sha256
      end
    end

    # @param user [User] owner of every record that may be approved
    # @param reports [Array<Hash>] receipts with record_type, record_id, fingerprints and optional revision
    # @param ai_task [AiTask, nil] needed for job, gap_response and interview_question receipts
    # @param interview [InterviewSession, nil] set only by record_interview_sources
    def initialize(user:, reports:, ai_task: nil, interview: nil)
      @user, @reports, @ai_task, @interview = user, reports, ai_task, interview
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
      return send(entry[:approve], record_id, receipts) if entry[:approve]

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

    # Preferences are JSON entries inside one owned profile, while catalogue listings
    # are shared rows. Both still use the common receipt shape and exact-value rule.
    def preference_scope(_record_type)
      return unless task_for_user? && @ai_task.check_job_preferences?

      { profile_id: @ai_task.input["profile_id"] }
    end

    def approve_preference_criterion(record_id, receipts)
      snapshot = Array(@ai_task.input["criteria"]).find { |item| item.is_a?(Hash) && item["id"] == record_id }
      return unless snapshot && snapshot["text"].is_a?(String)
      profile = @user.job_preference_profile
      return unless profile && profile.id == @ai_task.input["profile_id"]

      profile.with_lock do
        current = (profile.draft_criteria + profile.confirmed_criteria).any? do |item|
          item["id"] == record_id && item["text"] == snapshot["text"]
        end
        fingerprint = self.class.field_fingerprint(snapshot["text"])
        next unless current && receipts.any? { |receipt| receipt["fingerprints"]["text"] == fingerprint }

        combined = profile.screened_criteria_sha256 | [ fingerprint ]
        profile.update!(screened_criteria_sha256: combined) if combined != profile.screened_criteria_sha256
      end
    end

    def approve_preference_listing(record_id, receipts)
      return unless @ai_task.check_job_preferences?
      listings = @ai_task.input["listings"]
      return unless listings.is_a?(Array) && listings.size.between?(1, JobPreferences::StartCheckService::MAX_LISTINGS)
      snapshot = listings.find { |item| item.is_a?(Hash) && item["id"] == record_id }
      return unless snapshot && snapshot["passages"].is_a?(Array)
      record = JobBoardListing.find_by(id: record_id)
      return unless record

      record.with_lock do
        # Rebuild the same bounded excerpt, not the whole source digest: a previous
        # partial check must never approve passages that were not in that check.
        budget = [ JobPreferences::StartCheckService::TEXT_BUDGET_BYTES / listings.size,
          JobBoard::PreferenceListingSnapshot::MAX_TEXT_BYTES ].min
        current = JobBoard::PreferenceListingSnapshot.new(record).snapshot(max_text_bytes: budget)
        next unless current["source_digest"] == snapshot["source_digest"] && current["passages"] == snapshot["passages"]

        fingerprint = self.class.field_fingerprint(current["passages"].pluck("text"))
        next unless receipts.any? { |receipt| receipt["fingerprints"]["passages"] == fingerprint }

        record.update!(screened_sha256: fingerprint) unless record.screened_sha256 == fingerprint
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
      scope = { records: records }
      if task_for_user? && %w[review_library_section improve_library_entry].include?(@ai_task.task_type)
        library = @ai_task.input.fetch("library", {})
        values = case record_type
        when "user" then [ { "id" => library["summary_record_id"], "summary" => library["summary"] } ]
        when "experience_highlight" then Array(library["experiences"]).flat_map { |role| Array(role["highlights"]) }
        else Array(library[record_type.pluralize])
        end
        scope[:snapshots] = values.select { |value| value.is_a?(Hash) }.index_by { |value| value["id"] }
      end
      scope
    end

    # Only the job a gap analysis or tailoring task is about, or a spoken interview's own job.
    def job_scope(_record_type)
      return interview_job_scope if @interview
      return unless task_for_user? && @ai_task.subject_type == "Job" && %w[analyze_gaps tailor_resume].include?(@ai_task.task_type)

      { records: @user.jobs.where(id: @ai_task.subject_id) }
    end

    # A spoken interview may approve only its own owned saved job, never any other job.
    def interview_job_scope
      return unless @interview.user_id == @user.id && @interview.job_id

      { records: @user.jobs.where(id: @interview.job_id) }
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

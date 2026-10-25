# Remembers checks only for owned practice sources at their exact queued/current revisions.
# Called in the existing owner-before-task transaction, before applying generated content.
require "digest"
require "json"

module InterviewPrep
  class RecordScreeningService < ApplicationService
    FIELDS = %w[question_text answer_text].freeze

    def self.field_fingerprint(value)
      Digest::SHA256.hexdigest(JSON.generate(value))
    end

    def initialize(ai_task:, reports:)
      @task, @reports = ai_task, reports
    end

    # @return [ServiceResult] malformed, foreign, deleted and outdated reports are ignored.
    def call
      return success(nil) unless @reports.is_a?(Array) && @reports.any?
      return success(nil) unless %w[review_interview_answer regenerate_interview_question].include?(@task.task_type) && @task.subject_type == "InterviewQuestion"

      input = @task.input
      set = @task.user.interview_question_sets.find_by(id: input["question_set_id"])
      return success(nil) unless set && set.set_type == input.fetch("set_type", "general")
      target = set.questions.find_by(id: @task.subject_id)
      return success(nil) unless target && target.id == input["question_id"]

      sources = { target.id => input }
      if @task.regenerate_interview_question?
        peers, texts = input["other_question_snapshots"], input["other_questions"]
        if peers.is_a?(Array) && texts.is_a?(Array) && peers.length == texts.length
          ids = peers.filter_map { |peer| peer["question_id"] if peer.is_a?(Hash) }
          if ids.length == peers.length && ids.uniq.length == ids.length && !ids.include?(target.id)
            peers.zip(texts).each do |peer, text|
              next unless peer["question_set_id"] == set.id && peer["question_text"] == text && peer["question_id"].is_a?(String)
              sources[peer["question_id"]] = peer
            end
          end
        end
      end
      @reports.select { |report| report.is_a?(Hash) && report["question_id"].is_a?(String) }
        .group_by { |report| report["question_id"] }.sort.each do |id, reports|
        source = sources[id]
        next unless source
        record = set.questions.find_by(id: id)
        next unless record
        record_fields(record, source, reports, primary: id == target.id)
      end
      success(nil)
    end

    private

    def record_fields(record, source, reports, primary:)
      record.with_lock do
        fields = reports.flat_map do |report|
          next [] unless report["fields"].is_a?(Hash) && source["question_revision"].is_a?(Integer) &&
            report["question_revision"] == source["question_revision"] && record.question_revision == source["question_revision"]

          report["fields"].filter_map do |field, fingerprint|
            next unless FIELDS.include?(field) && source[field].is_a?(String) && fingerprint.is_a?(String) && fingerprint.match?(/\A[0-9a-f]{64}\z/)
            if field == "answer_text"
              next unless primary && @task.review_interview_answer? && source["answer_revision"].is_a?(Integer) &&
                report["answer_revision"] == source["answer_revision"] && record.answer_revision == source["answer_revision"]
            end
            next unless fingerprint == self.class.field_fingerprint(source[field]) && fingerprint == self.class.field_fingerprint(record[field])
            field
          end
        end
        combined = record.screened_fields | fields
        record.update!(screened_fields: combined) if combined != record.screened_fields
      end
    rescue ActiveRecord::RecordNotFound
      nil
    end
  end
end

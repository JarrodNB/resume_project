# Reads one five-question batch at a time, oldest first, as one stable job collection.
# The cursor remains usable after the end so newly generated questions can be appended.
module StudyGuides
  class ListQuestionBatchesService < ApplicationService
    def initialize(job:, user:, cursor: nil)
      @job, @user, @cursor = job, user, cursor
    end

    def call
      all = QuestionCollection.batches(job: @job, user: @user)
      batches = all
      if @cursor.present?
        position = verifier.verified(@cursor, purpose: "study-question-collection")
        return invalid_cursor unless position.is_a?(Hash) && position["job_id"] == @job.id
        batches = batches.where("(created_at, id) > (?, ?)", Time.iso8601(position.fetch("created_at")), position.fetch("id"))
      end
      rows = batches.order(:created_at, :id).limit(1).to_a
      last = rows.last
      cursor = last ? verifier.generate({ "job_id" => @job.id, "created_at" => last.created_at.iso8601(6), "id" => last.id }, purpose: "study-question-collection") : @cursor
      content = rows.map do |batch|
        { id: batch.id, result: batch.result,
          source_description_fingerprint: DescriptionFingerprint.source_fingerprint(batch),
          out_of_date: DescriptionFingerprint.task_out_of_date?(batch, description: @job.description) }
      end
      success(batches: content, end_cursor: cursor, total_questions: all.count * 5, errors: [])
    rescue ArgumentError, KeyError
      invalid_cursor
    end

    private

    def invalid_cursor
      failure([ "Invalid question cursor. Reload the job to try again." ])
    end

    def verifier
      Rails.application.message_verifier("study-question-collection")
    end
  end
end

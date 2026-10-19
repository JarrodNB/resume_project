# Description: Saves the user's answer to one requirement of a job. A blank answer removes it.
# "Add to career library" upserts a library fact (requirement plus answer) and links it; leaving
# it unchecked keeps the answer on the job only. Embedding sync runs only when a fact is
# created, updated, or deleted.
# Index:
#   - call: saves, updates, or clears the response and returns it (nil when cleared)
module GapResponses
  class SaveGapResponseService < ApplicationService
    def initialize(job:, requirement:, body:, add_to_library:)
      @job = job
      @requirement = requirement.to_s
      @body = body.to_s.strip
      @add_to_library = add_to_library
    end

    # Saves the answer, or removes it when the text is blank.
    def call
      return failure([ "Requirement can't be blank" ]) if @requirement.blank?

      response = @job.gap_responses.find_by(requirement: @requirement)
      return clear(response) if @body.blank?

      save(response || @job.gap_responses.build(requirement: @requirement))
    end

    private

    # Removes the job's answer and the fact it was the last link to.
    def clear(response)
      return success(nil) if response.nil?

      fact = response.library_fact
      cleared = false
      ApplicationRecord.transaction do
        raise ActiveRecord::Rollback unless response.destroy

        unlink_fact(fact)
        cleared = true
      end
      return failure(response.errors) unless cleared

      success(nil)
    end

    # Upserts the answer and, when asked, the library fact.
    def save(response)
      fact_changed = false
      errors = nil
      saved = false
      ApplicationRecord.transaction do
        previous_fact = response.library_fact
        response.body = @body
        if @add_to_library
          fact, fact_changed = upsert_fact
          unless fact.persisted?
            errors = fact.errors
            raise ActiveRecord::Rollback
          end
          response.library_fact = fact
        else
          response.library_fact = nil
        end
        RecordScreening::InvalidateService.call(record: response)
        unless response.save
          errors = response.errors
          raise ActiveRecord::Rollback
        end
        unlink_fact(previous_fact)
        saved = true
      end
      return failure(errors || [ "Couldn't save that response" ]) unless saved

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@job.user_id) if fact_changed
      success(response)
    end

    # Finds the user's fact for this requirement and updates its text when it changed.
    # Returns the fact and whether its text changed.
    def upsert_fact
      fact = @job.user.library_facts.find_or_initialize_by(requirement: @requirement)
      return [ fact, false ] if fact.persisted? && fact.response == @body

      fact.response = @body
      RecordScreening::InvalidateService.call(record: fact)
      fact.save
      [ fact, fact.persisted? ]
    end

    # Deletes a fact no response still points at. DestroyRecordService queues the embedding sync.
    def unlink_fact(fact)
      return if fact.nil? || fact.job_gap_responses.exists?

      result = Records::DestroyRecordService.call(record: fact)
      raise ActiveRecord::Rollback unless result.success?
    end
  end
end

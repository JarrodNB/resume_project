# Locks the owner before answers and career context entries, matching career-library clear and result writes.
# Reloads saved answers before editing and invalidating checks. Savepoints roll back
# handled failures inside the owner transaction, including earlier answer/context writes.
# Description: Saves the user's answer to one requirement of a job. A blank answer removes it.
# "Add to career library" upserts a career context (requirement plus answer) and links it; leaving
# it unchecked keeps the answer on the job only. Embedding sync runs only when a context is
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

      @job.user.with_lock do
        response = @job.gap_responses.find_by(requirement: @requirement)
        if @body.blank?
          clear(response)
        else
          save(response || @job.gap_responses.build(requirement: @requirement))
        end
      end
    end

    private

    # Removes the job's answer and the context it was the last link to.
    def clear(response)
      return success(nil) if response.nil?

      cleared = false
      ApplicationRecord.transaction(requires_new: true) do
        response.lock!
        context = response.career_context
        raise ActiveRecord::Rollback unless response.destroy

        unlink_context(context)
        cleared = true
      end
      return failure(response.errors) unless cleared

      success(nil)
    end

    # Upserts the answer and, when asked, the career context.
    def save(response)
      context_changed = false
      errors = nil
      saved = false
      ApplicationRecord.transaction(requires_new: true) do
        response.lock! if response.persisted?
        previous_context = response.career_context
        response.body = @body
        response.discard_changed_screened_fields
        if @add_to_library
          context, context_changed = upsert_context
          unless context.persisted?
            errors = context.errors
            raise ActiveRecord::Rollback
          end
          response.career_context = context
        else
          response.career_context = nil
        end
        unless response.save
          errors = response.errors
          raise ActiveRecord::Rollback
        end
        unlink_context(previous_context)
        saved = true
      end
      return failure(errors || [ "Couldn't save that response" ]) unless saved

      CareerLibrary::SyncLibraryEmbeddingsJob.perform_later(@job.user_id) if context_changed
      success(response)
    end

    # Finds the user's context for this requirement and updates its text when it changed.
    # Returns the context and whether its text changed.
    def upsert_context
      context = @job.user.career_contexts.find_or_initialize_by(requirement: @requirement)
      context.lock! if context.persisted?
      return [ context, false ] if context.persisted? && context.response == @body

      context.response = @body
      context.discard_changed_screened_fields
      context.save
      [ context, context.persisted? ]
    end

    # Deletes a context no response still points at. DestroyRecordService queues the embedding sync.
    def unlink_context(context)
      return if context.nil? || context.job_gap_responses.exists?

      result = Records::DestroyRecordService.call(record: context)
      raise ActiveRecord::Rollback unless result.success?
    end
  end
end

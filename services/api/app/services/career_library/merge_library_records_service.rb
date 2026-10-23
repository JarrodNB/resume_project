# Combines owned duplicate library entries in one transaction. Experiences delegate to
# their role-aware merger; other entry types fill blank fields without overwriting prose.
# A successful merge removes a saved source and queues embedding synchronization.
module CareerLibrary
  class MergeLibraryRecordsService < ApplicationService
    # An experience's blank end_date means "current role", so it is never filled from another record.
    FILLABLE_FIELDS = {
      Experience => %w[location description],
      Project => %w[role url description start_date end_date],
      Education => %w[field_of_study description start_date end_date],
      Certification => %w[issuer issued_date expiry_date credential_id credential_url description]
    }.freeze

    # @param target [Experience, Project, Education, Certification] the record that is kept
    # @param source [Experience, Project, Education, Certification] the record merged into it (saved or unsaved)
    def initialize(target:, source:)
      @target = target
      @source = source
    end

    # Fills blanks, adds new highlights, saves the target, and deletes a saved source.
    def call
      error = mismatch_error
      return failure([ error ]) if error

      @target.user.with_lock do
        return Experiences::MergeExperiencesService.call(target: @target, source: @source) if @target.is_a?(Experience)

        [ @target, @source ].select(&:persisted?).sort_by(&:id).each(&:lock!)
        fill_blank_fields
        RecordScreeningService.discard_changed_fields(record: @target)
        @target.save!
        @source.destroy! if @source.persisted?
        SyncLibraryEmbeddingsJob.perform_later(@target.user_id)
      end
      success(@target)
    rescue ActiveRecord::RecordInvalid => error
      failure(error.record.errors)
    end

    private

    # Returns why the two records can't be merged, or nil.
    def mismatch_error
      if !FILLABLE_FIELDS.key?(@target.class) || @target.class != @source.class
        "Only entries of the same kind can be merged"
      elsif @target.user_id != @source.user_id
        "Only your own entries can be merged"
      elsif @source.persisted? && @source.id == @target.id
        "An entry can't be merged into itself"
      end
    end

    # Copies each fillable field that is blank on the target and present on the source.
    def fill_blank_fields
      FILLABLE_FIELDS.fetch(@target.class).each do |field|
        next unless @target[field].blank? && @source[field].present?

        @target[field] = @source[field]
        if @target.is_a?(Certification) && %w[issued_date expiry_date].include?(field)
          @target["#{field}_precision"] = @source["#{field}_precision"]
        end
      end
    end
  end
end

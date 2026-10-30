# Locks the owner before deterministically locking both rows, then fills only current blanks.
# Description: Merges one career library record into another of the same model and user. Fields
# blank on the target are filled from the source (existing values are never overwritten); an
# experience also gains the source's highlights it doesn't already have. A saved source is then
# deleted. Exact text copied from a saved source keeps its trusted field coverage;
# imported, unsaved text starts unchecked. Used by imports and merge mutations. The
# user's library embeddings are re-synced after the merge commits.
# Index:
#   - FILLABLE_FIELDS: fields copied when blank on the target, per model
#   - call: merges in one transaction; returns the target, or errors
module CareerLibrary
  class MergeLibraryRecordsService < ApplicationService
    # An experience's blank end_date means "current role", so it is never filled from another record.
    FILLABLE_FIELDS = {
      Experience => %w[location description start_date],
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
        [ @target, @source ].select(&:persisted?).sort_by(&:id).each(&:lock!)
        fill_blank_fields
        copied_coverage = @source.persisted? ? @target.changed & @source.screened_fields : []
        add_new_highlights if @target.is_a?(Experience)
        @target.discard_changed_screened_fields
        @target.screened_fields |= copied_coverage
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

    # Appends the source's highlights whose text the target doesn't have yet.
    def add_new_highlights
      known = @target.highlights.map { |highlight| normalize(highlight.content) }.to_set
      next_position = (@target.highlights.map(&:position).max || -1) + 1
      @source.highlights.each do |highlight|
        next unless known.add?(normalize(highlight.content))

        @target.highlights.build(content: highlight.content, position: next_position,
          screened_fields: highlight.persisted? ? highlight.screened_fields & [ "content" ] : [])
        next_position += 1
      end
    end

    # Lowercases and squishes text for comparison.
    def normalize(text)
      text.to_s.squish.downcase
    end
  end
end

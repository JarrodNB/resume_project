# Saves one career library entry (role, project, education, skill, certification or career
# context) for the user, whether it is new or being edited. Every library save goes through
# here so the shared rules live in one place instead of in twelve per-kind services:
#
# - the owner (user) row is locked first, then the entry row, so saves for one user run one
#   at a time and the library size limit and skill position cannot race;
# - kind-specific clean-up of the submitted values (ongoing dates, certification precision);
# - on edit, "already screened" marks are dropped for fields whose text changed;
# - one embedding sync is queued after a successful save.
#
# It does not authorize anything: callers pass the signed-in user and an entry they loaded
# through that user. Merge, import and clear have their own paths and do not use this.
module CareerLibrary
  class SaveLibraryEntryService < ApplicationService
    # What differs between kinds. `normalize` cleans submitted attributes, `errors` turns a
    # failed record into messages, and `append` puts a new entry after the user's others.
    Kind = Struct.new(:association, :normalize, :errors, :append, :reload_after_update, keyword_init: true)

    KEEP_ATTRIBUTES = ->(attributes) { attributes }
    RECORD_ERRORS = ->(entry) { entry.errors }
    ONGOING_DATES = ->(attributes) { OngoingDates.normalize(attributes) }
    # A date given without a precision is a full day.
    DAY_PRECISION_FOR_DATES = lambda do |attributes|
      values = attributes.to_h.symbolize_keys
      %i[issued_date expiry_date].each do |field|
        precision = :"#{field}_precision"
        values[precision] = "day" if values.key?(field) && !values.key?(precision)
      end
      values
    end

    KINDS = {
      experience: Kind.new(association: :experiences, normalize: KEEP_ATTRIBUTES, errors: RECORD_ERRORS,
        reload_after_update: true),
      project: Kind.new(association: :projects, normalize: ONGOING_DATES, errors: RECORD_ERRORS),
      education: Kind.new(association: :educations, normalize: ONGOING_DATES, errors: RECORD_ERRORS),
      skill: Kind.new(association: :skills, normalize: KEEP_ATTRIBUTES, errors: Skills::ValidationErrors.method(:messages_for),
        append: true),
      certification: Kind.new(association: :certifications, normalize: DAY_PRECISION_FOR_DATES, errors: RECORD_ERRORS),
      career_context: Kind.new(association: :career_contexts, normalize: KEEP_ATTRIBUTES, errors: RECORD_ERRORS)
    }.freeze

    # @param user [User] the owner; the entry is created for them or must already belong to them
    # @param kind [Symbol] one of KINDS' keys
    # @param attributes [Hash] submitted fields
    # @param entry [ApplicationRecord, nil] the saved entry to edit; nil creates a new one
    # @param highlights [Array<String>, nil] experiences only. Creating saves them in order.
    #   Editing replaces the list in order (nil leaves it alone); exact unchanged text keeps
    #   its record, saved reviews and screening coverage, and changed text starts unchecked.
    def initialize(user:, kind:, attributes:, entry: nil, highlights: nil)
      @kind = KINDS.fetch(kind)
      @user = user
      @entry = entry
      @attributes = @kind.normalize.call(attributes)
      @highlights = highlights
      raise ArgumentError, "highlights are only for experiences" if highlights && kind != :experience
      raise ArgumentError, "entry belongs to another user" if entry && entry.user_id != user.id
    end

    # @return [ServiceResult] the saved entry, or the validation messages
    def call
      @entry ? update_entry : create_entry
    rescue ActiveRecord::RecordNotUnique
      # A twin request committed the same skill name after validation passed. Career contexts
      # also have a unique index, but the owner lock serializes their saves, so re-raise anything else.
      raise unless @kind == KINDS[:skill]

      failure([ "You already have a skill called #{(@new_entry || @entry).name}" ])
    end

    private

    # The user lock is held while the entry saves, so the size limit counts rows no other
    # request is adding at the same time.
    def create_entry
      saved = locked_as_owner do
        @new_entry = @user.public_send(@kind.association).new(@attributes)
        @new_entry.position = (@user.public_send(@kind.association).maximum(:position) || -1) + 1 if @kind.append
        @highlights&.each_with_index { |content, position| @new_entry.highlights.build(content: content, position: position) }
        @new_entry.save
      end
      return failure(@kind.errors.call(@new_entry)) unless saved

      finish(@new_entry)
    end

    # Owner lock first, then the entry row (reloaded), so an approval earned after the editor
    # loaded the entry cannot outlive the edit. Failures roll back highlight changes too.
    def update_entry
      saved = locked_as_owner do
        @entry.lock!
        @entry.assign_attributes(@attributes)
        @entry.discard_changed_screened_fields
        replace_highlights if @highlights
        @entry.save
      end
      return failure(@kind.errors.call(@entry)) unless saved

      @entry.reload if @kind.reload_after_update
      finish(@entry)
    end

    # Runs the block in a transaction holding the user lock; a false result rolls it back.
    def locked_as_owner
      saved = false
      @user.with_lock(requires_new: true) do
        saved = yield
        raise ActiveRecord::Rollback unless saved
      end
      saved
    end

    def finish(entry)
      SyncLibraryEmbeddingsJob.perform_later(@user.id)
      success(entry)
    end

    # Match each saved bullet at most once, including when content is duplicated.
    # Review and edit tasks refer to these IDs, so unchanged bullets must survive saves.
    def replace_highlights
      existing = @entry.highlights.to_a.group_by(&:content)
      covered = @entry.highlights.select { |item| item.screened_fields.include?("content") }.map(&:content).to_set
      @highlights.each_with_index do |content, position|
        highlight = existing[content]&.shift
        if highlight
          highlight.update!(position: position)
        else
          @entry.highlights.build(content: content, position: position,
            screened_fields: covered.include?(content) ? [ "content" ] : [])
        end
      end
      existing.each_value { |items| items.each(&:destroy!) }
    end
  end
end

# Reloads the owner before clearing so concurrent summary approvals are invalidated atomically.
# Description: Empties one user's career library so a later resume import starts fresh.
# Removes roles (and their bullets), projects, education, certifications, skills, and career context entries, and clears the
# profile fields an import fills (name, contact, links, summary, search suggestions). The sign-in email, saved
# jobs, and tailored resumes stay. Job answers that pointed at a context stay, unlinked.
# Queues one embedding sync when any entry was removed. Running it twice changes nothing.
# Index:
#   - PROFILE_FIELDS: user columns the import fills, cleared here
#   - call: deletes the entries and clears the profile in one transaction; returns the user
module CareerLibrary
  class ClearCareerLibraryService < ApplicationService
    PROFILE_FIELDS = %i[name contact_email phone location links summary job_title_suggestions].freeze

    def initialize(user:)
      @user = user
    end

    # Deletes every library entry and clears the import-filled profile fields.
    def call
      removed_entries = false
      @user.with_lock do
        removed_entries = delete_entries
        clear_profile
      end
      SyncLibraryEmbeddingsJob.perform_later(@user.id) if removed_entries
      success(@user.reload)
    end

    private

    # Deletes the user's library rows. Highlight rows and context links are handled by foreign keys.
    def delete_entries
      removed = [ Experience, Project, Education, Certification, Skill, CareerContext ].sum do |model|
        model.where(user_id: @user.id).delete_all
      end
      removed.positive?
    end

    # Sets each import-filled profile column back to blank.
    def clear_profile
      blank = PROFILE_FIELDS.index_with { |column| %i[links job_title_suggestions].include?(column) ? [] : nil }
      changes = blank.select { |column, value| @user.public_send(column) != value }
      if changes.any?
        @user.assign_attributes(changes)
        RecordScreeningService.discard_changed_fields(record: @user)
        @user.save!
      end
    end
  end
end

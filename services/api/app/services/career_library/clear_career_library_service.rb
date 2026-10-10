# Description: Empties one user's career library so a later resume import starts fresh.
# Removes roles (and their bullets), projects, education, certifications, skills, and facts, and clears the
# profile fields an import fills (name, contact, links, summary). The sign-in email, saved
# jobs, and tailored resumes stay. Job answers that pointed at a fact stay, unlinked.
# Queues one embedding sync when any entry was removed. Running it twice changes nothing.
# Index:
#   - PROFILE_FIELDS: user columns the import fills, cleared here
#   - call: deletes the entries and clears the profile in one transaction; returns the user
module CareerLibrary
  class ClearCareerLibraryService < ApplicationService
    PROFILE_FIELDS = %i[name contact_email phone location links summary].freeze

    def initialize(user:)
      @user = user
    end

    # Deletes every library entry and clears the import-filled profile fields.
    def call
      removed_entries = false
      ActiveRecord::Base.transaction do
        removed_entries = delete_entries
        clear_profile
      end
      SyncLibraryEmbeddingsJob.perform_later(@user.id) if removed_entries
      success(@user.reload)
    end

    private

    # Deletes the user's library rows. Highlight rows and fact links are handled by foreign keys.
    def delete_entries
      removed = [ Experience, Project, Education, Certification, Skill, LibraryFact ].sum do |model|
        model.where(user_id: @user.id).delete_all
      end
      removed.positive?
    end

    # Sets each import-filled profile column back to blank.
    def clear_profile
      blank = PROFILE_FIELDS.index_with { |column| column == :links ? [] : nil }
      changes = blank.select { |column, value| @user.public_send(column) != value }
      @user.update!(changes) if changes.any?
    end
  end
end

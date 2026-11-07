# Distinguishes ongoing education/projects from entries whose end date is simply unknown.
# Existing undated entries keep their meaning; no status is inferred from a blank date.
class AddOngoingToLibraryEntries < ActiveRecord::Migration[8.1]
  def change
    %i[projects educations].each do |table|
      add_column table, :ongoing, :boolean, default: false, null: false
      add_check_constraint table, "NOT ongoing OR end_date IS NULL", name: "#{table}_ongoing_without_end_date"
    end
  end
end

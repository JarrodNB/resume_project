# Existing library fields start unchecked. Successful AI checks are remembered on each record.
class AddLibraryScreenedFields < ActiveRecord::Migration[8.1]
  def change
    %i[users experiences experience_highlights projects educations certifications skills library_facts].each do |table|
      add_column table, :screened_fields, :text, array: true, default: [], null: false
    end
  end
end

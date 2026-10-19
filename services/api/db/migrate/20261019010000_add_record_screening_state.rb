# Each saved source keeps its own successful check. Existing sources start unchecked.
class AddRecordScreeningState < ActiveRecord::Migration[8.1]
  def change
    %i[users jobs experiences projects educations certifications skills library_facts job_gap_responses interview_questions].each do |table|
      add_column table, :screened_at, :datetime
      add_column table, :screening_policy_version, :string
    end
  end
end

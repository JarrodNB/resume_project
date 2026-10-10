# Description: Preserves stated credential date precision without changing other resume dates.
# Index: change adds year/month/day precision metadata; legacy dates retain day precision
class AddCertificationDatePrecision < ActiveRecord::Migration[8.1]
  # Adds precision metadata for imported and manually edited credential dates.
  def change
    add_column :certifications, :issued_date_precision, :string, null: false, default: "day"
    add_column :certifications, :expiry_date_precision, :string, null: false, default: "day"
  end
end

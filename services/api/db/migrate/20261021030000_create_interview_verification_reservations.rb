# Keep the one verification allowance durable even after an interview or account is deleted.
# No audio, dialogue, credentials or user identifiers belong in this ledger.
class CreateInterviewVerificationReservations < ActiveRecord::Migration[8.1]
  def change
    create_table :interview_verification_reservations, id: :uuid do |t|
      t.uuid :observation_id, null: false
      t.bigint :reserved_microdollars, null: false
      t.bigint :actual_microdollars
      t.timestamps
    end
    add_index :interview_verification_reservations, :observation_id, unique: true
    add_check_constraint :interview_verification_reservations,
      "reserved_microdollars > 0 AND (actual_microdollars IS NULL OR actual_microdollars >= 0)",
      name: "interview_verification_nonnegative_costs"
  end
end

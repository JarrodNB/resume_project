# Description: Destroys a record the caller has already authorized (looked up via current_user).
# Index:
#   - call: destroys the record; returns it on success, errors on failure
module Records
  class DestroyRecordService < ApplicationService
    def initialize(record:)
      @record = record
    end

    # Destroys the record.
    def call
      @record.destroy ? success(@record) : failure(@record.errors)
    end
  end
end

# Forgets "already screened" marks on fields the user just changed.
# Call under the record's row lock after assigning edits and before saving; reload before
# assigning so a concurrent approval of the old text is also dropped. The screened field
# list for each model lives in Screening::RecordApprovalsService::RECORD_TYPES.
module ScreenedFields
  extend ActiveSupport::Concern

  def discard_changed_screened_fields
    self.screened_fields -= changed & Screening::RecordApprovalsService.fields_for_model(self.class.name)
  end
end

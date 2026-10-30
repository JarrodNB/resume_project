# Lets a model name the text fields the AI worker screens, and forgets "already screened"
# marks on those fields when the user changes them.
# Declare the list with `screenable_fields %w[...]`. Call `discard_changed_screened_fields`
# under the record's row lock after assigning edits and before saving; reload before
# assigning so a concurrent approval of the old text is also dropped.
module ScreenedFields
  extend ActiveSupport::Concern

  included do
    class_attribute :screened_field_names, instance_writer: false, default: [].freeze
  end

  class_methods do
    def screenable_fields(names)
      self.screened_field_names = names.map(&:to_s).freeze
    end
  end

  def discard_changed_screened_fields
    self.screened_fields -= changed & self.class.screened_field_names
  end
end

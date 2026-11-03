# Remember the order a user wants new resume sections in. Empty means the standard order.
class AddResumeSectionOrderToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :resume_section_order, :text, array: true, default: [], null: false
  end
end

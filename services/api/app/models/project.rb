# Description: Career library entry for a personal, open source, or work project.
class Project < ApplicationRecord
  include MostRecentFirst

  belongs_to :user

  validates :name, presence: true
end

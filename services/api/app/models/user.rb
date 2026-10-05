# Description: An account holder. Authenticates with Devise; API requests carry a JWT.
# Index:
#   - profile columns: name, contact_email, phone, location, links, summary
#   - career library: experiences, projects, educations (most recent first), skills (by position)
#   - jobs, resumes, ai_tasks
#   - library_embeddings: vectors of the career library entries (derived data)
class User < ApplicationRecord
  devise :database_authenticatable, :registerable, :validatable,
         :jwt_authenticatable, jwt_revocation_strategy: JwtDenylist

  has_many :experiences, -> { most_recent_first }, dependent: :destroy
  has_many :projects, -> { most_recent_first }, dependent: :destroy
  has_many :educations, -> { most_recent_first }, dependent: :destroy
  has_many :skills, -> { order(:position) }, dependent: :destroy
  has_many :jobs, dependent: :destroy
  has_many :resumes, dependent: :destroy
  has_many :ai_tasks, dependent: :destroy
  has_many :library_embeddings, dependent: :delete_all
end

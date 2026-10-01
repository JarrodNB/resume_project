# Description: An account holder. Authenticates with Devise; API requests carry a JWT.
# Index:
#   - career library: experiences, projects, educations, skills
#   - jobs, resumes, ai_tasks
class User < ApplicationRecord
  devise :database_authenticatable, :registerable, :recoverable, :validatable,
         :jwt_authenticatable, jwt_revocation_strategy: JwtDenylist

  has_many :experiences, -> { order(:position) }, dependent: :destroy
  has_many :projects, -> { order(:position) }, dependent: :destroy
  has_many :educations, -> { order(:position) }, dependent: :destroy
  has_many :skills, -> { order(:position) }, dependent: :destroy
  has_many :jobs, dependent: :destroy
  has_many :resumes, dependent: :destroy
  has_many :ai_tasks, dependent: :destroy
end

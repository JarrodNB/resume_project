# Description: Revoked JWTs. devise-jwt adds a row on sign-out and rejects tokens listed here.
class JwtDenylist < ApplicationRecord
  include Devise::JWT::RevocationStrategies::Denylist
end

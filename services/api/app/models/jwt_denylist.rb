# Legacy token revocations retained for database compatibility during coordinated rollout.
# Browser authentication never reads this table.
class JwtDenylist < ApplicationRecord
end

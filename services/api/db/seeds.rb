# Creates two confirmed, synthetic accounts for development browser checks.
# Existing accounts keep their passwords and saved work. These public fixture
# credentials must never create accounts outside development; see docs/testing.md.
if Rails.env.development?
  User.transaction do
    [
      [ "qa.primary@example.test", "QA Primary" ],
      [ "qa.secondary@example.test", "QA Secondary" ]
    ].each do |email, name|
      User.find_or_create_by!(email: email) do |user|
        user.name = name
        user.password = "local cedar lantern harbor 2026"
        user.skip_confirmation!
      end
    end
  end
end

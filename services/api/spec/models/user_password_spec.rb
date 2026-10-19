# New password rules protect registrations and future changes without locking out older accounts.
require "rails_helper"

RSpec.describe User, type: :model do
  it "rejects newly chosen passwords shorter than 15 characters" do
    user = build(:user, password: "fourteen chars")
    expect(user).not_to be_valid
    expect(user.errors[:password]).to include("is too short (minimum is 15 characters)")
  end

  it "rejects Unicode passwords above bcrypt's 72-byte limit" do
    user = build(:user, password: "é" * 37)
    expect(user).not_to be_valid
    expect(user.errors[:password]).to include("must be 72 bytes or fewer (some characters use more than one byte)")
  end

  it "rejects a common long password and case variations" do
    [ "d41d8cd98f00b204e9800998ecf8427e", "D41D8CD98F00B204E9800998ECF8427E" ].each do |password|
      user = build(:user, password: password)
      expect(user).not_to be_valid
      expect(user.errors[:password].join).to include("common password")
    end
  end

  it "applies the same rules to replacement passwords without changing the saved hash on failure" do
    user = create(:user, password: "a quiet orchard after rain")
    expect(user.update(password: "too short")).to be(false)
    expect(user.reload.valid_password?("a quiet orchard after rain")).to be(true)
    expect(user.update(password: "d41d8cd98f00b204e9800998ecf8427e")).to be(false)
    expect(user.reload.update(password: "quiet orchard\0after rain")).to be(false)
    expect(user.reload.update(password: false)).to be(false)
    expect(user.reload.valid_password?("a quiet orchard after rain")).to be(true)
    expect(user.update(password: "another calm orchard after rain")).to be(true)
    expect(user.reload.valid_password?("another calm orchard after rain")).to be(true)
  end
end

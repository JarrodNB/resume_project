# Exercise new-password limits through registration and preserve access to older accounts.
require "rails_helper"

RSpec.describe "Password policy", type: :request do
  def register(password)
    post "/auth/sign_up", params: { user: { email: "new@example.com", password: password } }, as: :json
  end

  it "returns validation errors for missing passwords rather than crashing" do
    [ nil, "" ].each do |password|
      register(password)
      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to include("Password can't be blank")
    end
  end

  it "returns a safe validation error for embedded NUL characters" do
    register("quiet orchard\0after rain")
    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to include("Password cannot contain a null character")
  end

  [ "a" * 14, "🌳" * 14, "d41d8cd98f00b204e9800998ecf8427e", "é" * 37, "a" * 73 ].each do |password|
    it "rejects an unacceptable password without creating an account (#{password.bytesize} bytes)" do
      expect { register(password) }.not_to change(User, :count)
      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"].join).to include("Password")
    end
  end

  [ "orchard dusk tea", "🌳" * 15, "é" * 36, "qz" * 36, " 🌳 " + "é" * 10 + " rain " ].each do |password|
    it "accepts and preserves a passphrase within the boundaries (#{password.bytesize} bytes)" do
      register(password)
      expect(response).to have_http_status(:created)
      user = User.find_by!(email: "new@example.com")
      expect(user.valid_password?(password)).to be(true)
      expect(user.valid_password?(password.strip)).to be(false) unless password == password.strip
    end
  end

  [ "short", "a" * 73, "é" * 37 ].each do |password|
    it "authenticates legacy passwords and permits profile changes (#{password.bytesize} bytes)" do
      user = build(:user, password: nil, encrypted_password: Devise::Encryptor.digest(User, password))
      user.save!(validate: false) # Simulates a hash saved before the stronger policy.
      post "/auth/sign_in", params: { user: { email: user.email, password: password } }, as: :json
      expect(response).to have_http_status(:ok)
      expect(user.reload.update(name: "Updated name")).to be(true)
      expect(user.reload.valid_password?(password)).to be(true)
    end
  end

  [ 123456789012345, true, false ].each do |password|
    it "rejects non-text credentials safely (#{password.inspect})" do
      register(password)
      expect(response).to have_http_status(:unprocessable_content)
      user = create(:user)
      post "/auth/sign_in", params: { user: { email: user.email, password: password } }, as: :json
      expect(response).to have_http_status(:unauthorized)
    end
  end

  it "rejects a NUL-containing login with the ordinary invalid-credentials response" do
    user = create(:user)
    post "/auth/sign_in", params: { user: { email: user.email, password: "invalid\0credential" } }, as: :json
    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("Invalid email or password.")
  end
end

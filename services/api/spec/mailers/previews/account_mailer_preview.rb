# Development-only preview with a synthetic account; never reads real confirmation tokens.
class AccountMailerPreview < ActionMailer::Preview
  def confirmation_instructions
    AccountMailer.confirmation_instructions(User.new(email: "preview@example.com"), "preview-confirmation-token")
  end
end

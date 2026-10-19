# Development-only preview with a synthetic account; never reads real confirmation tokens.
class AccountMailerPreview < ActionMailer::Preview
  def confirmation_instructions
    AccountMailer.confirmation_instructions(User.new(email: "preview@example.com"), "preview-confirmation-token")
  end

  def reset_password_instructions
    AccountMailer.reset_password_instructions(User.new(email: "preview@example.com"), "preview-recovery-token")
  end
end

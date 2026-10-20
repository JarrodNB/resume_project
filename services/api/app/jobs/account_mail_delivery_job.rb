# Uses Rails' mail queue with bounded retries and redacted arguments and delivery failures.
class AccountMailDeliveryJob < ActionMailer::MailDeliveryJob
  class DeliveryFailure < StandardError; end
  self.log_arguments = false
  self.enqueue_after_transaction_commit = true
  retry_on DeliveryFailure, wait: :polynomially_longer, attempts: 3

  around_enqueue do |job, enqueue|
    begin
      enqueue.call
    rescue SolidQueue::Job::EnqueueError, ActiveRecord::ActiveRecordError
      raise ActiveJob::EnqueueError, "Account email enqueue failed", cause: nil
    ensure
      # Active Job captures its own enqueue errors instead of raising them.
      job.enqueue_error = ActiveJob::EnqueueError.new("Account email enqueue failed") if job.enqueue_error
    end
  end

  def perform(...)
    super
  rescue Net::SMTPError, IOError, SystemCallError, Timeout::Error, SocketError, OpenSSL::SSL::SSLError
    # SMTP servers can echo addresses/credentials. Only this fixed message reaches job logs.
    raise DeliveryFailure, "Account email delivery failed", cause: nil
  end
end

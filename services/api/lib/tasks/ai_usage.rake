# Audit unresolved costs and import verified provider receipts without making provider calls.
# Receipts are JSON arrays; each row names its owned accounting request and exact replacement usage.
namespace :ai_usage do
  desc "List unresolved task attempts and background embedding requests"
  task unresolved: :environment do
    AiUsageAttempt.where(incomplete: true).includes(:ai_task, :usage_entries).find_each do |report|
      puts({ record_type: "task", user_id: report.ai_task.user_id, attempt_id: report.attempt_id,
        created_at: report.created_at, usage: AiUsage::AttemptEntries.as_hashes(report) }.to_json)
    end
    AiEmbeddingRequest.where(incomplete: true).find_each do |request|
      puts({ record_type: "embedding", user_id: request.user_id, attempt_id: request.id,
        created_at: request.created_at, model: request.model, input_tokens: request.input_tokens }.to_json)
    end
  end

  desc "Dry-run verified RECEIPTS=<json file>; set APPLY=true to reconcile once with an audit trail"
  task reconcile: :environment do
    receipts = JSON.parse(File.read(ENV.fetch("RECEIPTS")))
    abort "Expected a JSON array of verified receipts" unless receipts.is_a?(Array)
    receipts.each do |receipt|
      user = User.find(receipt.fetch("user_id"))
      result = AiUsage::ReconcileReceiptService.call(user: user, record_type: receipt.fetch("record_type"),
        attempt_id: receipt.fetch("attempt_id"), receipt_reference: receipt.fetch("receipt_reference"),
        usage: receipt.fetch("usage"), apply: ENV["APPLY"] == "true")
      abort result.errors.join(", ") unless result.success?
      puts({ attempt_id: receipt.fetch("attempt_id"), applied: ENV["APPLY"] == "true", result: result.value }.to_json)
    end
  end
end

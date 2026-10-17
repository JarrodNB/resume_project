# Validate PDF result identity and calculate five equally weighted local checks.
module AtsChecks
  class ApplyPdfResultService < ApplicationService
    KEYS = %w[text_extraction coverage reading_order characters boundaries].freeze
    IDENTITY = %w[run_id resume_id content_fingerprint rubric_version renderer_version digest].freeze
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end
    def call
      run = @task.user.ats_check_runs.find_by(id: @task.input["run_id"])
      return failure([ "PDF snapshot is unavailable." ]) unless run
      run.with_lock do
        # Superseded exports remain historical tasks; they cannot replace the current slot.
        return success(run) unless run.pdf_result["task_id"] == @task.id
        unless @result.is_a?(Hash) && IDENTITY.all? { |key| @result[key] == @task.input[key] }
          return failure([ "Invalid PDF inspection identity. Export again." ])
        end
        checks = @result["checks"]
        unless checks.is_a?(Array) && checks.all? { |c| c.is_a?(Hash) && c["key"].is_a?(String) } && checks.map { |c| c["key"] }.sort == KEYS.sort && checks.all? { |c| valid_check?(c) }
          return failure([ "Invalid PDF inspection findings. Export again." ])
        end
        assessments = checks.map do |check|
          ratio = check["ratio"]
          check.merge("status" => ratio >= 0.98 ? "pass" : ratio >= 0.9 ? "partial" : "fail")
        end
        values = assessments.map { |c| c["status"] == "pass" ? 1.0 : c["status"] == "partial" ? 0.5 : 0.0 }
        deductions = assessments.each_with_index.map { |c, i| { "key" => c["key"], "points" => ((1 - values[i]) * 20).round(2) } }
        run.update!(pdf_result: run.pdf_result.merge("status" => "completed", "score" => (values.sum * 20).round,
          "assessments" => assessments, "deductions" => deductions, "reason" => nil))
        success(run)
      end
    end
    private
    def valid_check?(check)
      ratio = check["ratio"]
      ratio.is_a?(Numeric) && ratio.finite? && ratio.between?(0, 1) &&
        check["explanation"].is_a?(String) && check["explanation"].present? &&
        check["suggested_action"].is_a?(String) && %w[info warning error].include?(check["severity"]) &&
        check["evidence"].is_a?(Array) && check["evidence"].all? do |entry|
          entry.is_a?(Hash) && entry["page"].is_a?(Integer) && entry["page"].between?(1, 50) &&
            entry["excerpt"].is_a?(String) && entry["excerpt"].length.between?(1, 500)
        end
    end
  end
end

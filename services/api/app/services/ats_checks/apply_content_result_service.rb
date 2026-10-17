# Validate evidence and compute the published rubric locally inside the task-result transaction.
module AtsChecks
  class ApplyContentResultService < ApplicationService
    VALUES = { "pass" => 1.0, "partial" => 0.5, "fail" => 0.0,
               "covered" => 1.0, "missing" => 0.0 }.freeze

    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      run = @task.user.ats_check_runs.find_by(ai_task_id: @task.id)
      return failure([ "Check run not found." ]) unless run
      run.with_lock do
        return failure([ "Invalid check result." ]) unless valid?(run)
        requirements = @result["requirements"]
        checks = @result["checks"]
        alignment = category(requirements, run.job_snapshot["requirements"].to_h { |r| [ r["id"], r["required"] ? 2 : 1 ] }, "requirement_id")
        quality = category(checks.reject { |c| c["status"] == "unavailable" }, nil, "key")
        run.update!(status: "completed", error_message: nil,
                    content_result: { "job_alignment" => alignment, "content_quality" => quality })
        success(run)
      end
    end

    private

    def valid?(run)
      return false unless @result.is_a?(Hash)
      return false unless %w[run_id content_fingerprint job_fingerprint rubric_version].all? do |key|
        @result[key] == (key == "run_id" ? run.id : run.public_send(key))
      end
      requirements, checks = @result.values_at("requirements", "checks")
      return false unless requirements.is_a?(Array) && checks.is_a?(Array)
      return false unless requirements.all? { |r| r.is_a?(Hash) } && checks.all? { |c| c.is_a?(Hash) }
      expected = run.job_snapshot.fetch("requirements").map { |r| r["id"] }.sort
      return false unless requirements.all? { |r| r["requirement_id"].is_a?(String) } && requirements.map { |r| r["requirement_id"] }.sort == expected
      return false unless checks.all? { |c| c["key"].is_a?(String) } && checks.map { |c| c["key"] }.sort == Snapshot::CHECK_KEYS.sort
      sections = run.content_snapshot.to_h { |s| [ s["id"], s ] }
      requirements.all? { |r| assessment_valid?(r, %w[covered partial missing], sections, require_evidence: r["status"] != "missing") } &&
        checks.all? { |c| assessment_valid?(c, %w[pass partial fail unavailable], sections, require_evidence: c["status"] != "unavailable" && !verified_absence?(c, run)) }
    rescue KeyError, NoMethodError, ArgumentError, TypeError
      false
    end

    def assessment_valid?(item, statuses, sections, require_evidence:)
      return false unless statuses.include?(item["status"]) && item["explanation"].is_a?(String) && item["explanation"].present?
      return false unless item["suggested_action"].is_a?(String)
      return false unless %w[info warning error].include?(item["severity"])
      evidence = item["evidence"]
      return false unless evidence.is_a?(Array) && (!require_evidence || evidence.any?)
      evidence.all? do |reference|
        next false unless reference.is_a?(Hash) && reference["excerpt"].is_a?(String) && reference["excerpt"].present?
        section = sections[reference["section_id"]]
        section && strings(section.slice("title", "content")).any? { |text| text.include?(reference["excerpt"]) }
      end
    end

    def verified_absence?(item, run)
      return false unless item["status"] == "fail" && item["absence_reason"].is_a?(String) && item["absence_reason"].present?
      case item["key"]
      when "contact_usability"
        contacts = run.content_snapshot.select { |section| section["section_type"] == "contact" }
        contacts.none? do |section|
          content = section["content"]
          content["email"].to_s.match?(/\A[^\s@]+@[^\s@]+\.[^\s@]+\z/) ||
            content["phone"].to_s.gsub(/\D/, "").length >= 7
        end
      when "section_labels"
        run.content_snapshot.none? { |section| section["title"].to_s.strip.present? }
      else false
      end
    end

    def strings(value)
      case value
      when Hash then value.values.flat_map { |v| strings(v) }
      when Array then value.flat_map { |v| strings(v) }
      when String then [ value ]
      else []
      end
    end

    def category(items, weights, key)
      return { "status" => "unavailable", "reason" => "No applicable checks or usable job requirements.", "assessments" => [] } if items.empty?
      total = items.sum { |item| weights ? weights.fetch(item[key]) : 1 }
      earned = items.sum { |item| VALUES.fetch(item["status"]) * (weights ? weights.fetch(item[key]) : 1) }
      deductions = items.map do |item|
        { "key" => item[key], "points" => ((1 - VALUES.fetch(item["status"])) * (weights ? weights.fetch(item[key]) : 1) * 100 / total).round(2) }
      end
      { "status" => "completed", "score" => (earned * 100 / total).round,
        "assessments" => items, "deductions" => deductions }
    end
  end
end

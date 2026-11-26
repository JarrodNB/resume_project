# Owns what "the answer" to a practice question means: the selected format's draft, its readable
# text, whether it counts as answered, and whether saved feedback still matches it.
# Each question keeps one draft per written format (plain text, CAR, CARL, STAR); only the selected
# one is the active answer. Inactive drafts are saved privately and never count as an answer.
#
# Blank rule (the same in Postgres, Python and the web app): text is blank when it holds only
# Ruby's `[[:space:]]` characters, as `blank?` and `squish` see them: tab, newline, vertical tab,
# form feed, carriage return, space, U+0085, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029,
# U+202F, U+205F and U+3000. U+FEFF, U+180E, U+200B and the controls U+001C-U+001F are text.
# Each other layer spells this set out explicitly (Python `str.strip`, JS `trim` and Postgres `\s`
# differ). Shared cases live in services/ai/tests/fixtures/active_answer_cases.json.
module InterviewPrep
  module ActiveAnswer
    FIELDS = {
      "plain_text" => %w[text], "car" => %w[context action result],
      "carl" => %w[context action result learning], "star" => %w[situation task action result]
    }.freeze

    # Old questions retain their exact free-form text until their first structured save.
    def self.drafts(question)
      return question.answer_drafts if question.answer_drafts.present?

      { "plain_text" => { "text" => question.answer_text } }
    end

    def self.blank?(text)
      text.to_s.blank?
    end

    # The selected format's readable text. Structured formats list only their filled fields.
    def self.render(format, drafts)
      fields = drafts.fetch(format, {})
      return fields.fetch("text", "") if format == "plain_text"

      FIELDS.fetch(format).filter_map do |field|
        value = fields.fetch(field, "")
        "#{field.capitalize}: #{value}" unless blank?(value)
      end.join("\n\n")
    end

    def self.valid?(format, drafts)
      FIELDS.key?(format) && drafts.is_a?(Hash) && (drafts.keys - FIELDS.keys).empty? &&
        drafts.all? do |key, fields|
          fields.is_a?(Hash) && (fields.keys - FIELDS.fetch(key)).empty? &&
            fields.values.all? { |value| value.is_a?(String) && value.length <= TextLimits::INTERVIEW_ANSWER } &&
            fields.values.sum(&:length) <= TextLimits::INTERVIEW_ANSWER &&
            render(key, drafts).length <= TextLimits::INTERVIEW_ANSWER
        end
    end

    # The saved question's `answer_text` column is always the active answer's text (SaveAnswerService
    # writes it), so this reads it and ignores inactive drafts.
    def self.answered?(question)
      !blank?(question.answer_text)
    end

    # Collapses whitespace runs and capitalization so formatting-only edits do not change freshness.
    # Saved review digests were made from exactly this (`squish.downcase`), so keep it unchanged.
    def self.normalize(text)
      text.to_s.squish.downcase
    end

    def self.fingerprint(text)
      Digest::SHA256.hexdigest(normalize(text))
    end

    # True when saved feedback no longer matches the question and active answer.
    # Exact revisions are authoritative; a formatting-only edit in the same format reuses the feedback
    # when the completed review task's saved fingerprint still matches. Chat's practice tools use a
    # stricter exact-revision copy (practice_feedback_status in services/ai/mcp_tools/interview_questions.py).
    def self.feedback_outdated?(question)
      return false if question.feedback.blank?
      return true if question.feedback_question_revision != question.question_revision
      return true if question.feedback_answer_revision.to_i < question.answer_format_revision
      return false if question.feedback_answer_revision == question.answer_revision

      task = question.ai_tasks.where(task_type: "review_interview_answer", status: "completed")
        .where("input ->> 'question_revision' = ? AND input ->> 'answer_revision' = ?",
          question.feedback_question_revision.to_s, question.feedback_answer_revision.to_s)
        .order(created_at: :desc, id: :desc).first
      return true unless task

      matching_feedback = task.result&.fetch("interview_feedback", nil) == question.feedback
      unchanged = task.input&.fetch("answer_format", "plain_text") == question.answer_format &&
        task.input&.fetch("normalized_answer_sha256", nil) == fingerprint(question.answer_text)
      !(matching_feedback && unchanged)
    end

    # Where the question sits on its answer → feedback line, from saved state and the latest task.
    # Returns :unanswered, :answered (no feedback yet), :reviewing, :reviewed or :outdated.
    def self.progress(question, latest_task: nil)
      return :reviewing if latest_task&.task_type == "review_interview_answer" && latest_task.status == "queued"
      return :unanswered unless answered?(question)
      return :answered if question.feedback.blank?

      feedback_outdated?(question) ? :outdated : :reviewed
    end
  end
end

# Keeps four bounded written answer drafts together and renders only the selected one.
# Old questions retain their exact free-form text until their first structured save.
module InterviewPrep
  module AnswerFormats
    FIELDS = {
      "plain_text" => %w[text], "car" => %w[context action result],
      "carl" => %w[context action result learning], "star" => %w[situation task action result]
    }.freeze

    def self.drafts(question)
      return question.answer_drafts if question.answer_drafts.present?

      { "plain_text" => { "text" => question.answer_text } }
    end

    def self.render(format, drafts)
      fields = drafts.fetch(format, {})
      return fields.fetch("text", "") if format == "plain_text"

      FIELDS.fetch(format).filter_map do |field|
        value = fields.fetch(field, "")
        "#{field.capitalize}: #{value}" if value.present?
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

    def self.answered?(question)
      drafts(question).any? { |_, values| values.values.any? { |text| text.present? } }
    end
  end
end

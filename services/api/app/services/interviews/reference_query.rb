# Builds a bounded search query only from the saved prompt and accepted dialogue.
# Whole messages are retained; acknowledgements, drafts and provisional captures are excluded.
module Interviews
  module ReferenceQuery
    MAX_CHARACTERS = 12_004 # Three complete 4,000-character messages plus separators.

    def self.for(interview, message)
      return message.content unless message.follow_up?

      answer = interview.messages.where(question_id: message.question_id, kind: "answer")
        .where("position < ?", message.position).order(:position).last
      parts = [ message.question.content, answer&.content, message.content ].compact
      query = parts.join("\n\n")
      query.length <= MAX_CHARACTERS ? query : message.content
    end
  end
end

# Selects complete accepted public question groups without copying private model history.
# Newer groups get first use of the content-character budget; returned groups keep chronology.
module Interviews
  module EarlierDialogue
    CHARACTER_BUDGET = 12_000

    def self.build(interview, before_position:)
      remaining = CHARACTER_BUDGET
      selected, omitted = [], []
      interview.questions.where("position < ?", before_position).reorder(position: :desc).each do |question|
        messages = interview.messages.where(question: question, kind: %w[opening answer follow_up]).order(:position)
          .map { |message| { kind: message.kind, content: MessageText.spoken_content(message) } }
        next unless messages.any? { |message| message[:kind] == "answer" }

        size = messages.sum { |message| message[:content].length }
        if size <= remaining
          selected << { question_position: question.position, messages: messages }
          remaining -= size
        else
          omitted << question.position
        end
      end
      { version: 1, character_budget: CHARACTER_BUDGET, groups: selected.reverse,
        omitted_question_positions: omitted.sort }
    end
  end
end

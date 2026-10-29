# Reads the owned successful question batches shared by collection paging and generation.
# Old development topic results are not part of the question collection.
module StudyGuides
  module QuestionCollection
    MAX_PREVIOUS_QUESTIONS = 200
    MAX_PREVIOUS_CHARACTERS = 40_000

    QUESTION_ARRAY_SQL = "CASE WHEN jsonb_typeof(result->'study_guide'->'questions') = 'array' THEN result->'study_guide'->'questions' ELSE '[]'::jsonb END".freeze
    QUESTION_TEXT_LIMITS = { "question" => 1_000, "why_it_matters" => 1_000, "answer" => 6_000, "example" => 3_000 }.freeze

    def self.batches(job:, user:)
      invalid_fields = QUESTION_TEXT_LIMITS.map do |field, limit|
        "jsonb_typeof(item->'#{field}') IS DISTINCT FROM 'string' OR item->>'#{field}' !~ '[^[:space:]]' OR char_length(item->>'#{field}') > #{limit}"
      end.join(" OR ")
      job.ai_tasks.where(user_id: user.id, task_type: "generate_study_guide", status: "completed")
        .where("result->'study_guide'->>'version' = '1'")
        .where("jsonb_typeof(result->'study_guide'->'title') = 'string' AND result->'study_guide'->>'title' ~ '[^[:space:]]' AND char_length(result->'study_guide'->>'title') <= 200")
        .where("jsonb_array_length(#{QUESTION_ARRAY_SQL}) = 5")
        .where("NOT EXISTS (SELECT 1 FROM jsonb_array_elements(#{QUESTION_ARRAY_SQL}) AS item WHERE #{invalid_fields})")
    end

    def self.prompts(job:, user:)
      batches(job: job, user: user).order(:created_at, :id).pluck(:result).flat_map do |result|
        result.fetch("study_guide").fetch("questions").filter_map { |question| question["question"] if question.is_a?(Hash) && question["question"].is_a?(String) }
      end
    end

    def self.normalize(question)
      question.unicode_normalize(:nfkc).downcase.gsub(/[^\p{Alnum}]+/, " ").strip
    end
  end
end

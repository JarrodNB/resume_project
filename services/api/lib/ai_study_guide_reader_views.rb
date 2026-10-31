# Exposes current study jobs and validated generated prompts without broad task-result access.
# These ordinary views read existing rows; they store no source copies.
module AiStudyGuideReaderViews
  def self.create(connection)
    connection.execute(<<~SQL)
      CREATE OR REPLACE VIEW ai_study_guide_commands AS
      SELECT t.id AS task_id, t.user_id, t.status, t.created_at, j.id AS job_id, j.description
      FROM ai_tasks t JOIN jobs j ON j.id = t.subject_id AND j.user_id = t.user_id
      WHERE t.task_type = 'generate_study_guide' AND t.subject_type = 'Job'
        AND t.input->>'job_id' = j.id::text
    SQL
    questions = "CASE WHEN jsonb_typeof(t.result->'study_guide'->'questions') = 'array' THEN t.result->'study_guide'->'questions' ELSE '[]'::jsonb END"
    invalid = { "question" => 1000, "why_it_matters" => 1000, "answer" => 6000, "example" => 3000 }.map do |field, limit|
      "jsonb_typeof(item->'#{field}') IS DISTINCT FROM 'string' OR item->>'#{field}' !~ '[^[:space:]]' OR char_length(item->>'#{field}') > #{limit}"
    end.join(" OR ")
    connection.execute(<<~SQL)
      CREATE OR REPLACE VIEW ai_study_guide_questions AS
      SELECT t.id AS task_id, t.user_id, j.id AS job_id, t.created_at,
        q.position, q.item->>'question' AS question
      FROM ai_tasks t JOIN jobs j ON j.id = t.subject_id AND j.user_id = t.user_id
      CROSS JOIN LATERAL jsonb_array_elements(#{questions}) WITH ORDINALITY AS q(item, position)
      WHERE t.task_type = 'generate_study_guide' AND t.subject_type = 'Job' AND t.status = 'completed'
        AND t.result->'study_guide'->>'version' = '1'
        AND jsonb_typeof(t.result->'study_guide'->'title') = 'string'
        AND t.result->'study_guide'->>'title' ~ '[^[:space:]]'
        AND char_length(t.result->'study_guide'->>'title') <= 200
        AND jsonb_array_length(#{questions}) = 5
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(#{questions}) AS item WHERE #{invalid})
    SQL
  end
end

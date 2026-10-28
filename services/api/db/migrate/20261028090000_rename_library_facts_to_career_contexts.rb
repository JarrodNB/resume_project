# Renames saved career context without replacing records, job links, or embeddings.
# Only structural JSON keys/discriminators change; user text and model history stay exact.
# Deploy Rails and AI workers together, with queue consumers paused during migration.
class RenameLibraryFactsToCareerContexts < ActiveRecord::Migration[8.1]
  SNAPSHOTS = {
    ai_tasks: %i[input result],
    interview_sessions: %i[frozen_context fixture_context],
    interview_career_references: %i[references],
    interview_session_operations: %i[accepted_result],
    interview_questions: %i[feedback]
  }.freeze

  def up
    rename_table :library_facts, :career_contexts
    rename_column :job_gap_responses, :library_fact_id, :career_context_id
    rename_sources("LibraryFact", "CareerContext")
    rewrite_snapshots(false)
  end

  def down
    rewrite_snapshots(true)
    rename_sources("CareerContext", "LibraryFact")
    rename_column :job_gap_responses, :career_context_id, :library_fact_id
    rename_table :career_contexts, :library_facts
  end

  private

  def rename_sources(old_name, new_name)
    execute <<~SQL
      UPDATE library_embeddings SET source_type = #{quote(new_name)} WHERE source_type = #{quote(old_name)}
    SQL
  end

  # Walk JSON structurally rather than replacing text in serialized snapshots. In particular,
  # an answer such as "Facts matter" must remain byte-for-byte unchanged.
  def rewrite_snapshots(reverse)
    execute <<~SQL
      CREATE FUNCTION pg_temp.rename_career_context(value jsonb, reverse boolean) RETURNS jsonb
      LANGUAGE plpgsql AS $$
      DECLARE output jsonb; entry record; new_key text; new_value jsonb;
      BEGIN
        IF jsonb_typeof(value) = 'object' THEN
          output := '{}'::jsonb;
          FOR entry IN SELECT * FROM jsonb_each(value) LOOP
            new_key := entry.key;
            IF NOT reverse THEN
              new_key := CASE entry.key WHEN 'facts' THEN 'career_contexts' WHEN 'library_facts' THEN 'career_contexts'
                WHEN 'library_fact' THEN 'career_context' ELSE entry.key END;
            ELSE
              -- Frozen interview sources use a type discriminator; library snapshots use facts.
              new_key := CASE entry.key WHEN 'career_contexts' THEN 'facts'
                WHEN 'career_context' THEN 'library_fact' ELSE entry.key END;
            END IF;
            new_value := pg_temp.rename_career_context(entry.value, reverse);
            IF jsonb_typeof(entry.value) = 'string' THEN
              IF entry.key IN ('source_type', 'record_type') THEN
                IF NOT reverse AND entry.value = '"LibraryFact"'::jsonb THEN new_value := '"CareerContext"'::jsonb;
                ELSIF reverse AND entry.value = '"CareerContext"'::jsonb THEN new_value := '"LibraryFact"'::jsonb;
                ELSIF NOT reverse AND entry.key = 'record_type' AND entry.value = '"library_fact"'::jsonb THEN new_value := '"career_context"'::jsonb;
                ELSIF reverse AND entry.key = 'record_type' AND entry.value = '"career_context"'::jsonb THEN new_value := '"library_fact"'::jsonb; END IF;
              ELSIF entry.key = 'section' THEN
                IF NOT reverse AND entry.value = '"facts"'::jsonb THEN new_value := '"career_contexts"'::jsonb;
                ELSIF reverse AND entry.value = '"career_contexts"'::jsonb THEN new_value := '"facts"'::jsonb; END IF;
              ELSIF entry.key = 'kind' THEN
                IF NOT reverse AND entry.value IN ('"library_fact"'::jsonb, '"fact"'::jsonb) THEN new_value := '"career_context"'::jsonb;
                ELSIF reverse AND entry.value = '"career_context"'::jsonb THEN
                  new_value := CASE WHEN value ? 'record_id' THEN '"library_fact"'::jsonb ELSE '"fact"'::jsonb END;
                END IF;
              ELSIF entry.key = 'type' THEN
                IF NOT reverse AND entry.value = '"library_facts"'::jsonb THEN new_value := '"career_contexts"'::jsonb;
                ELSIF reverse AND entry.value = '"career_contexts"'::jsonb THEN new_value := '"library_facts"'::jsonb; END IF;
              END IF;
            END IF;
            output := output || jsonb_build_object(new_key, new_value);
          END LOOP;
          RETURN output;
        ELSIF jsonb_typeof(value) = 'array' THEN
          SELECT coalesce(jsonb_agg(pg_temp.rename_career_context(element, reverse) ORDER BY position), '[]'::jsonb)
            INTO output FROM jsonb_array_elements(value) WITH ORDINALITY AS items(element, position);
          RETURN output;
        END IF;
        RETURN value;
      END $$;
    SQL
    SNAPSHOTS.each do |table, columns|
      columns.each do |column|
        execute <<~SQL
          UPDATE #{quote_table_name(table)} SET #{quote_column_name(column)} = pg_temp.rename_career_context(#{quote_column_name(column)}, #{reverse})
          WHERE #{quote_column_name(column)} IS NOT NULL AND #{quote_column_name(column)}::text ~ '(library_fact|LibraryFact|"facts"|career_context|CareerContext)'
        SQL
      end
    end
    execute "DROP FUNCTION pg_temp.rename_career_context(jsonb, boolean)"
  end
end

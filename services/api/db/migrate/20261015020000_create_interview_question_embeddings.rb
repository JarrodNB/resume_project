# Description: Stores one derived vector per current interview Q&A without retrieval access.
# Index:
#   - change: creates unique question storage with database cascade cleanup
class CreateInterviewQuestionEmbeddings < ActiveRecord::Migration[8.1]
  # Keeps ownership through the question and prevents orphaned or duplicate vectors.
  def change
    create_table :interview_question_embeddings, id: :uuid do |t|
      t.references :interview_question, type: :uuid, null: false,
                   index: { unique: true }, foreign_key: { on_delete: :cascade }
      t.text :content, null: false
      t.string :content_digest, null: false
      t.string :model, null: false
      t.vector :embedding, limit: 1536, null: false
      t.integer :question_revision, null: false
      t.integer :answer_revision, null: false
      t.timestamps
    end
    add_check_constraint :interview_question_embeddings, "question_revision > 0 AND answer_revision >= 0",
                         name: "interview_embedding_revisions_valid"
  end
end

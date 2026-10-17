# Description: Synchronizes only one owned, saved Q&A; provider work never holds an owner lock.
# Index:
#   - call: snapshots current content, embeds outside owner transactions, then rejects stale results
module InterviewPrep
  class SyncQuestionEmbeddingService < ApplicationService
    # Receives the deterministic owner and question identity, never provider-supplied ownership.
    def initialize(user:, question_id:, embedding_client: Embeddings::OpenAiEmbeddingClient.new)
      @user, @question_id, @client = user, question_id, embedding_client
    end

    # Returns whether a current vector was written.
    def call
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        key = connection.quote("interview_embedding:#{@question_id}")
        connection.execute("SELECT pg_advisory_lock(hashtextextended(#{key}, 0))")
        begin
          snapshot = @user.with_lock { current_snapshot }
          return success(false) unless snapshot

          vector = @client.embed_texts([ snapshot[:outbound] ]).first
          written = @user.with_lock { persist_if_current(snapshot, vector) }
          success(written)
        ensure
          connection.execute("SELECT pg_advisory_unlock(hashtextextended(#{key}, 0))")
        end
      end
    rescue ActiveRecord::RecordNotFound
      success(false)
    end

    private

    # Resolves the question exclusively through its persisted owner and current answer.
    def owned_question
      InterviewQuestion.joins(:interview_question_set)
        .where(interview_question_sets: { user_id: @user.id }).find_by(id: @question_id)
    end

    # Captures source revisions and original/masked text, skipping an already current row.
    def current_snapshot
      question = owned_question
      return unless question&.answer_text.present?

      snapshot = snapshot_for(question)
      stored = question.embedding
      return if stored && stored.content_digest == snapshot[:content_digest] &&
                stored.model == @client.model && stored.question_revision == question.question_revision &&
                stored.answer_revision == question.answer_revision && stored.content == snapshot[:content]

      snapshot
    end

    # Includes contact-derived outbound text so profile changes during HTTP also reject results.
    def snapshot_for(question)
      content = "Question: #{question.question_text}\nAnswer: #{question.answer_text}"
      outbound = Embeddings::MaskContact.mask(content, @user)
      { content: content, outbound: outbound, question_revision: question.question_revision,
        answer_revision: question.answer_revision,
        content_digest: Digest::SHA256.hexdigest("#{@client.model}\n#{outbound}") }
    end

    # Writes only if the exact saved source still exists under the same owner.
    def persist_if_current(snapshot, vector)
      question = owned_question
      return false unless question&.answer_text.present? && snapshot_for(question) == snapshot

      attributes = snapshot.except(:outbound).merge(model: @client.model, embedding: vector)
      (question.embedding || question.build_embedding).update!(attributes)
      true
    end
  end
end

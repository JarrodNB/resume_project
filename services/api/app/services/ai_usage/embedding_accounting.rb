# Commits one marker before each paid embedding call and its receipt before vector writes.
# A separate connection keeps charges durable when the library's outer transaction rolls back.
# No source text or embedding vector is stored in this ledger.
module AiUsage
  class EmbeddingAccounting
    PRICES = JSON.parse(Rails.root.join("config/ai_embedding_prices.json").read).freeze

    def self.start(user:, model:, purpose:)
      durable { AiEmbeddingRequest.create!(user_id: user.id, model: model, purpose: purpose).id }
    end

    def self.finish(id:, model:, tokens:)
      durable do
        request = AiEmbeddingRequest.find_by(id: id)
        next unless request

        request.with_lock do
          next if request.finalized?

          rate = PRICES[model] if request.model == model
          known = rate && tokens.is_a?(Integer) && tokens.positive?
          cost = (BigDecimal(rate) * tokens).ceil if known
          request.update!(model: model.is_a?(String) && model.present? ? model : request.model,
            input_tokens: tokens.is_a?(Integer) && tokens >= 0 ? tokens : nil,
            cost_microdollars: cost, finalized: true, incomplete: !known)
        end
      end
    end

    def self.durable(&block)
      Thread.new do
        Thread.current.report_on_exception = false
        ActiveRecord::Base.connection_pool.with_connection { block.call }
      end.value
    end
    private_class_method :durable
  end
end

# Description: Turns texts into embedding vectors with the OpenAI embeddings API. The one place Rails
# talks to OpenAI. Each batch records a durable user-owned accounting marker before dispatch,
# then retains its receipt before vector validation/persistence. Job retries bill separately.
# Index:
#   - BATCH_SIZE: texts sent per request
#   - configured?: whether an API key is set
#   - embed_texts: one vector per text, in the same order
module Embeddings
  class OpenAiEmbeddingClient
    BATCH_SIZE = 500

    # Whether OPENAI_API_KEY is set (without it, embedding syncs are skipped).
    def self.configured?
      ENV["OPENAI_API_KEY"].present?
    end

    # @param model [String] OpenAI embedding model name
    # @param dimensions [Integer] vector size to request
    def initialize(user:, purpose:, model: CareerLibraryEmbeddings::MODEL, dimensions: CareerLibraryEmbeddings::DIMENSIONS)
      @user, @purpose = user, purpose
      @model = model
      @dimensions = dimensions
    end

    attr_reader :model

    # Embeds the texts in batches; returns an array of float arrays matching the input order.
    def embed_texts(texts)
      texts.each_slice(BATCH_SIZE).flat_map do |batch|
        request_id = AiUsage::EmbeddingAccounting.start(user: @user, model: @model, purpose: @purpose)
        response = client.embeddings.create(model: @model, input: batch, dimensions: @dimensions,
          request_options: { extra_headers: { "X-Client-Request-Id" => request_id } })
        AiUsage::EmbeddingAccounting.finish(id: request_id, model: response.model, tokens: response.usage&.prompt_tokens)
        raise "Incomplete embedding response" unless response.data.size == batch.size

        response.data.sort_by(&:index).map(&:embedding)
      end
    end

    private

    # Disable hidden transport retries; the job creates a separately recorded batch on retry.
    def client
      @client ||= OpenAI::Client.new(api_key: ENV.fetch("OPENAI_API_KEY"), max_retries: 0)
    end
  end
end

# Description: Turns texts into embedding vectors with the OpenAI embeddings API. The one place Rails
# talks to OpenAI (embeddings are derived data with no prompt, so they skip the AI worker; see
# docs/architecture.md). Errors from the API are raised so the calling job can retry.
# Index:
#   - BATCH_SIZE: texts sent per request
#   - configured?: whether an API key is set
#   - embed_texts: one vector per text; yields tokens and cost for each billed batch
module Embeddings
  class OpenAiEmbeddingClient
    BATCH_SIZE = 500
    # USD per million input tokens, checked against OpenAI model docs on 2026-10-13.
    INPUT_PRICES = { "text-embedding-3-small" => Rational(2, 100),
                     "text-embedding-3-large" => Rational(13, 100),
                     "text-embedding-ada-002" => Rational(10, 100) }.freeze

    # Whether OPENAI_API_KEY is set (without it, embedding syncs are skipped).
    def self.configured?
      ENV["OPENAI_API_KEY"].present?
    end

    # @param model [String] OpenAI embedding model name
    # @param dimensions [Integer] vector size to request
    def initialize(model: CareerLibraryEmbeddings::MODEL, dimensions: CareerLibraryEmbeddings::DIMENSIONS)
      @model = model
      @dimensions = dimensions
    end

    attr_reader :model

    # Embeds the texts in batches; returns an array of float arrays matching the input order.
    def embed_texts(texts)
      price = INPUT_PRICES.fetch(@model)
      texts.each_slice(BATCH_SIZE).flat_map do |batch|
        response = client.embeddings.create(model: @model, input: batch, dimensions: @dimensions)
        tokens = response.usage.prompt_tokens
        yield(input_tokens: tokens, cost_microdollars: (tokens * price).ceil) if block_given?
        response.data.sort_by(&:index).map(&:embedding)
      end
    end

    private

    # The OpenAI SDK client (it retries rate limits and 5xx twice before raising).
    def client
      @client ||= OpenAI::Client.new(api_key: ENV.fetch("OPENAI_API_KEY"))
    end
  end
end

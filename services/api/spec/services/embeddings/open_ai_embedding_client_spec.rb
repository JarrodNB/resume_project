# Description: Verifies reported embedding token costs and accounting before later batch failures.
# Index:
#   - embed_texts: batching, rounding, unpriced models, and preserved usage
require "rails_helper"

RSpec.describe Embeddings::OpenAiEmbeddingClient do
  let(:client) { described_class.new }
  let(:endpoint) { double("embeddings endpoint") }

  before do
    allow(client).to receive(:client).and_return(double(embeddings: endpoint))
  end

  it "reports API tokens, rounds cost up, and returns vectors in input order" do
    response = double(usage: double(prompt_tokens: 101),
                      data: [ double(index: 1, embedding: [ 0.2 ]), double(index: 0, embedding: [ 0.1 ]) ])
    allow(endpoint).to receive(:create).and_return(response)
    usage = []

    vectors = client.embed_texts([ "first", "second" ]) { |batch| usage << batch }

    expect(vectors).to eq([ [ 0.1 ], [ 0.2 ] ])
    expect(usage).to eq([ { input_tokens: 101, cost_microdollars: 3 } ])
  end

  it "reports a successful batch even if a later batch fails" do
    response = double(usage: double(prompt_tokens: 100), data: [ double(index: 0, embedding: [ 0.1 ]) ])
    requests = 0
    allow(endpoint).to receive(:create) do
      requests += 1
      raise "provider failed" if requests == 2

      response
    end
    usage = []

    expect { client.embed_texts(Array.new(501, "text")) { |batch| usage << batch } }.to raise_error("provider failed")
    expect(usage).to eq([ { input_tokens: 100, cost_microdollars: 2 } ])
  end

  it "rejects unpriced models before making a request" do
    unpriced = described_class.new(model: "unpriced-model")
    allow(unpriced).to receive(:client).and_return(double(embeddings: endpoint))
    expect(endpoint).not_to receive(:create)

    expect { unpriced.embed_texts([ "text" ]) }.to raise_error(KeyError)
  end
end

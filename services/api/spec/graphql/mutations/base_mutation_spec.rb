# Description: Mutations::BaseMutation payloads carry the service result's machine-readable code as errorCode.
require "rails_helper"

RSpec.describe Mutations::BaseMutation do
  let(:mutation) { described_class.allocate }

  def payload(result) = mutation.send(:payload_from, result, :thing)

  it "maps a failure code to error_code next to the errors" do
    result = ServiceResult.new(success: false, value: nil, errors: [ "Nope" ], code: :plan_ended)

    expect(payload(result)).to eq(thing: nil, errors: [ "Nope" ], error_code: "plan_ended")
  end

  it "leaves error_code empty when the result has no code" do
    expect(payload(ServiceResult.new(success: true, value: 1, errors: []))).to eq(thing: 1, errors: [], error_code: nil)
  end

  def refusal(code) = ServiceResult.new(success: false, value: nil, errors: [ "Nope" ], code: code)

  it "leaves out a known internal code that clients do not see" do
    expect(payload(refusal(:connection_ended))).to eq(thing: nil, errors: [ "Nope" ], error_code: nil)
  end

  it "raises outside production for a code that is neither a client code nor a known internal one" do
    expect { payload(refusal(:surprise)) }.to raise_error(ArgumentError, /surprise/)
  end

  it "logs a warning in production for such a code and still leaves it out" do
    allow(Rails.env).to receive(:production?).and_return(true)
    allow(Rails.logger).to receive(:warn)

    expect(payload(refusal(:surprise))).to eq(thing: nil, errors: [ "Nope" ], error_code: nil)
    expect(Rails.logger).to have_received(:warn).with(/surprise/)
  end
end

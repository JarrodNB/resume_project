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
end

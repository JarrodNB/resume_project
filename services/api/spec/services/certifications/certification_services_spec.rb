# Description: Certification service validations and embedding job enqueueing.
# Index: creation, update and per-user count limit examples
require "rails_helper"

RSpec.describe "Certification services" do
  let(:user) { create(:user) }

  it "queues embedding synchronization after creation and updates" do
    credential = nil
    expect do
      result = Certifications::CreateCertificationService.call(user: user, attributes: { name: "AWS" })
      expect(result).to be_success
      credential = result.value
    end.to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob).with(user.id)
    expect do
      result = Certifications::UpdateCertificationService.call(certification: credential, attributes: { issuer: "Amazon" })
      expect(result).to be_success
    end.to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob).with(user.id)
    expect(credential.reload.issuer).to eq("Amazon")
  end

  it "returns validation errors and queues nothing for an invalid update" do
    credential = create(:certification, user: user)
    expect do
      result = Certifications::UpdateCertificationService.call(certification: credential, attributes: { name: "" })
      expect(result).not_to be_success
    end.not_to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob)
    expect(credential.reload.name).to eq("AWS Solutions Architect")
  end

  it "caps creation for the owner while still permitting updates" do
    create_list(:certification, TextLimits::MAX_CERTIFICATIONS, user: user)
    result = Certifications::CreateCertificationService.call(user: user, attributes: { name: "Another" })
    expect(result).not_to be_success
    expect(Certifications::UpdateCertificationService.call(certification: user.certifications.first, attributes: { description: "Updated" })).to be_success
  end
  it "allows partial precision and resets edited exact dates to day precision" do
    result = Certifications::CreateCertificationService.call(user: user, attributes: {
      name: "AWS", expiry_date: Date.new(2026, 10, 1), expiry_date_precision: "month"
    })
    expect(result).to be_success
    credential = result.value
    expect(Certifications::UpdateCertificationService.call(certification: credential, attributes: { expiry_date: Date.new(2026, 10, 31) })).to be_success
    expect(credential.reload).to have_attributes(expiry_date: Date.new(2026, 10, 31), expiry_date_precision: "day")
    expect(Certifications::UpdateCertificationService.call(certification: credential, attributes: { expiry_date_precision: "unknown" })).not_to be_success
  end

end

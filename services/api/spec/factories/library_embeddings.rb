# Description: Career library embedding factory (a highlight's embedding with a constant vector).
FactoryBot.define do
  factory :library_embedding do
    user
    source_type { "ExperienceHighlight" }
    source_id { SecureRandom.uuid }
    content { "Senior Engineer at Acme: Shipped a feature" }
    content_digest { Digest::SHA256.hexdigest(content) }
    model { CareerLibraryEmbeddings::MODEL }
    embedding { Array.new(CareerLibraryEmbeddings::DIMENSIONS, 0.1) }
  end
end

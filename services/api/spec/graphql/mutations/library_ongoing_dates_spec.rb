# Checks explicit ongoing education/project dates through owned GraphQL saves and reloads.
# A missing end date alone must stay unknown rather than becoming an ongoing claim.
require "rails_helper"

RSpec.describe "Ongoing career library entries" do
  let(:user) { create(:user) }

  { "Project" => { "name" => "Research" }, "Education" => { "institution" => "State" } }.each do |kind, identity|
    describe kind do
      let(:record_kind) { kind.underscore }

      def save_entry(kind, attributes, id: nil, user:)
        operation = "#{id ? 'update' : 'create'}#{kind}"
        variables = { attributes: attributes }
        variables[:id] = id if id
        result = execute_graphql(<<~GQL, user: user, variables: variables)
          mutation($attributes: #{kind}AttributesInput!#{id ? ', $id: ID!' : ''}) {
            #{operation}(input: { attributes: $attributes#{id ? ', id: $id' : ''} }) {
              #{kind.underscore} { id endDate ongoing }
              errors
            }
          }
        GQL
        result.dig("data", operation)
      end

      it "persists ongoing status, clears a supplied end, and preserves it on unrelated updates" do
        created = save_entry(kind, identity.merge("endDate" => "2025-01-01", "ongoing" => true), user: user)
        expect(created["errors"]).to eq([])
        record = user.public_send(kind.underscore.pluralize).find(created.dig(record_kind, "id"))
        expect(record.ongoing).to be(true)
        expect(record.end_date).to be_nil
        updated = save_entry(kind, identity, id: record.id, user: user)
        expect(updated[record_kind]).to include("ongoing" => true, "endDate" => nil)
      end

      it "keeps an unknown end distinct from ongoing, including explicit clearing" do
        created = save_entry(kind, identity, user: user)
        expect(created[record_kind]).to include("ongoing" => false, "endDate" => nil)
        updated = save_entry(kind, { "endDate" => nil, "ongoing" => false }, id: created.dig(record_kind, "id"), user: user)
        expect(updated[record_kind]).to include("ongoing" => false, "endDate" => nil)
      end

      it "can end an ongoing entry by supplying an end date without another status flag" do
        record = create(record_kind, user: user, ongoing: true, end_date: nil)
        updated = save_entry(kind, { "endDate" => "2026-05-15" }, id: record.id, user: user)
        expect(updated[record_kind]).to include("ongoing" => false, "endDate" => "2026-05-15")
      end

      it "rejects changing another owner's ongoing status" do
        record = create(record_kind, ongoing: true, end_date: nil)
        expect(save_entry(kind, { "ongoing" => false }, id: record.id, user: user)).to be_nil
        expect(record.reload.ongoing).to be(true)
      end

      it "does not fill an explicitly ongoing target end date when merging" do
        target = create(record_kind, user: user, ongoing: true, end_date: nil)
        source = create(record_kind, user: user, end_date: "2025-01-01")
        result = CareerLibrary::MergeLibraryRecordsService.call(target: target, source: source)
        expect(result).to be_success
        expect(target.reload.ongoing).to be(true)
        expect(target.end_date).to be_nil
      end
    end
  end
end

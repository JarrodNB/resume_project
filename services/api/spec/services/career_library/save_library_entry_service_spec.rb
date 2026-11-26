# Checks the rules every library save shares, once per kind: creating, editing, the size cap,
# the owner lock that makes the cap hold under concurrent requests, dropping screening marks
# for changed text, cleaning up submitted values, and queueing the embedding sync.
require "rails_helper"
require "timeout"

RSpec.describe CareerLibrary::SaveLibraryEntryService do
  include ActiveJob::TestHelper

  let(:user) { create(:user) }
  let(:sync_job) { CareerLibrary::SyncLibraryEmbeddingsJob }

  # kind, association, cap, attributes for a new entry, a changed field, and a screened field that must survive
  KINDS = [
    [ :experience, :experiences, TextLimits::MAX_EXPERIENCES, { company: "Acme", title: "Engineer" }, :title, :company ],
    [ :project, :projects, TextLimits::MAX_PROJECTS, { name: "CLI" }, :name, :description ],
    [ :education, :educations, TextLimits::MAX_EDUCATIONS, { institution: "State" }, :institution, :degree ],
    [ :skill, :skills, TextLimits::MAX_SKILLS, { name: "Ruby" }, :name, :category ],
    [ :certification, :certifications, TextLimits::MAX_CERTIFICATIONS, { name: "AWS" }, :name, :issuer ],
    [ :career_context, :career_contexts, TextLimits::MAX_CAREER_CONTEXTS, { requirement: "K8s", response: "Yes" },
      :response, :requirement ]
  ].freeze

  def save(kind, attributes, **options)
    described_class.call(user: user, kind: kind, attributes: attributes, **options)
  end

  KINDS.each do |kind, association, cap, new_attributes, changed_field, kept_field|
    describe "#{kind} entries" do
      it "creates the entry for the user and queues one embedding sync" do
        result = nil
        expect { result = save(kind, new_attributes) }.to have_enqueued_job(sync_job).with(user.id).once

        expect(result).to be_success
        expect(user.public_send(association).sole).to eq(result.value)
        expect(result.value).to have_attributes(new_attributes)
      end

      it "returns the model's validation errors and queues nothing for an invalid create" do
        blank = new_attributes.transform_values { "" }

        result = nil
        expect { result = save(kind, blank) }.not_to have_enqueued_job(sync_job)

        expect(result).not_to be_success
        expect(result.errors).not_to be_empty
        expect(user.public_send(association).count).to eq(0)
      end

      it "edits the entry, queues an embedding sync, and drops screening only for the changed field" do
        entry = create(kind, user: user, screened_fields: [ changed_field.to_s, kept_field.to_s ])

        result = nil
        expect { result = save(kind, { changed_field => "New text" }, entry: entry) }
          .to have_enqueued_job(sync_job).with(user.id).once

        expect(result).to be_success
        expect(entry.reload.public_send(changed_field)).to eq("New text")
        expect(entry.screened_fields).to eq([ kept_field.to_s ])
      end

      it "keeps screening when the text is saved unchanged" do
        entry = create(kind, user: user, screened_fields: [ changed_field.to_s, kept_field.to_s ])

        save(kind, { changed_field => entry.public_send(changed_field) }, entry: entry)

        expect(entry.reload.screened_fields).to contain_exactly(changed_field.to_s, kept_field.to_s)
      end

      it "returns errors and queues nothing for an invalid edit, leaving the entry as it was" do
        entry = create(kind, user: user, screened_fields: [ changed_field.to_s ])
        before = entry.public_send(changed_field)

        result = nil
        expect { result = save(kind, { changed_field => "" }, entry: entry) }.not_to have_enqueued_job(sync_job)

        expect(result).not_to be_success
        expect(entry.reload.public_send(changed_field)).to eq(before)
        expect(entry.screened_fields).to eq([ changed_field.to_s ])
      end

      it "refuses a create past the cap but still allows edits at the cap" do
        fill_library(kind, cap)

        result = nil
        expect { result = save(kind, new_attributes.merge(skill_name_for(kind))) }.not_to have_enqueued_job(sync_job)

        expect(result).not_to be_success
        expect(result.errors.join).to match(/up to #{cap}/)
        expect(user.public_send(association).count).to eq(cap)
        expect(save(kind, { changed_field => "Edited" }, entry: user.public_send(association).first)).to be_success
      end

      it "takes the owner lock first, then the entry's row lock when editing" do
        entry = create(kind, user: user)
        order = []
        allow(user).to receive(:with_lock).and_wrap_original { |original, *args, **options, &block| order << :owner; original.call(*args, **options, &block) }
        allow(entry).to receive(:lock!).and_wrap_original { |original, *args| order << :entry; original.call(*args) }

        save(kind, new_attributes.merge(skill_name_for(kind)))
        expect(order).to eq([ :owner ])

        save(kind, { changed_field => "Edited" }, entry: entry)
        expect(order).to eq([ :owner, :owner, :entry ])
      end
    end
  end

  # Career context topics must be unique per user.
  def fill_library(kind, count)
    return create_list(kind, count, user: user) unless kind == :career_context

    count.times { |index| create(kind, user: user, requirement: "Topic #{index}") }
  end

  # Skills need distinct names to stay valid when several are made.
  def skill_name_for(kind)
    kind == :skill ? { name: "Another skill" } : {}
  end

  describe "concurrent creates at the cap" do
    self.use_transactional_tests = false

    # Create the user up front so worker threads see it committed.
    before { allow(ApiSchema.subscriptions).to receive(:trigger); user }
    after { user.destroy! }

    KINDS.each do |kind, association, cap, new_attributes, _changed, _kept|
      it "lets only one of two simultaneous #{kind} requests take the last slot" do
        fill_library(kind, cap - 1)
        ready = Queue.new
        start = Queue.new
        threads = 2.times.map do |index|
          Thread.new do
            ActiveRecord::Base.connection_pool.with_connection do
              ready << true
              start.pop
              attributes = kind == :skill ? { name: "Racer #{index}" } : new_attributes
              described_class.call(user: User.find(user.id), kind: kind, attributes: attributes)
            end
          end
        end
        2.times { ready.pop }
        2.times { start << true }
        results = threads.map(&:value)

        expect(results.count(&:success?)).to eq(1)
        expect(user.public_send(association).count).to eq(cap)
      end
    end
  end

  describe "skills" do
    it "adds the skill after the user's other skills" do
      create(:skill, user: user, position: 4)

      expect(save(:skill, { name: "Ruby" }).value.position).to eq(5)
    end

    it "reports a duplicate name with the existing capitalization, on create and on rename" do
      create(:skill, user: user, name: "Ruby")
      other = create(:skill, user: user, name: "Go")

      expect(save(:skill, { name: "ruby" }).errors).to eq([ "You already have a skill called Ruby" ])
      expect(save(:skill, { name: "RUBY" }, entry: other).errors).to eq([ "You already have a skill called Ruby" ])
    end

    it "reports a duplicate name instead of raising when a twin request saves between validation and insert" do
      # Skipping validation stands in for the uniqueness check having passed before the twin committed.
      allow_any_instance_of(Skill).to receive(:save).and_wrap_original do |original, *|
        create(:skill, user: user, name: "Ruby")
        original.call(validate: false)
      end

      result = save(:skill, { name: "Ruby" })

      expect(result).not_to be_success
      expect(result.errors).to eq([ "You already have a skill called Ruby" ])
    end

    it "leaves the position alone when renaming" do
      skill = create(:skill, user: user, position: 7)

      save(:skill, { name: "Renamed" }, entry: skill)

      expect(skill.reload.position).to eq(7)
    end
  end

  describe "experience highlights on create" do
    it "saves the highlights in order with the role" do
      result = save(:experience, { company: "Acme", title: "Engineer" }, highlights: [ "First", "Second" ])

      expect(result.value.highlights.order(:position).pluck(:content, :position)).to eq([ [ "First", 0 ], [ "Second", 1 ] ])
    end

    it "saves nothing when the role is invalid" do
      result = save(:experience, { company: "", title: "" }, highlights: [ "First" ])

      expect(result).not_to be_success
      expect(ExperienceHighlight.count).to eq(0)
    end
  end

  describe "normalizing submitted values" do
    it "marks projects and education ongoing without an end date, and finished when an end date is given" do
      %i[project education].each do |kind|
        base = kind == :project ? { name: "Thing" } : { institution: "State" }

        ongoing = save(kind, base.merge(ongoing: true, end_date: Date.new(2020, 1, 1))).value
        expect(ongoing).to have_attributes(ongoing: true, end_date: nil)

        ended = save(kind, { end_date: Date.new(2021, 5, 1) }, entry: ongoing).value
        expect(ended).to have_attributes(ongoing: false, end_date: Date.new(2021, 5, 1))
      end
    end

    it "defaults a certification date given without a precision to day, on create and edit" do
      created = save(:certification, { name: "AWS", expiry_date: Date.new(2026, 10, 1), expiry_date_precision: "month" }).value
      expect(created.expiry_date_precision).to eq("month")

      edited = save(:certification, { expiry_date: Date.new(2026, 10, 31) }, entry: created).value
      expect(edited).to have_attributes(expiry_date: Date.new(2026, 10, 31), expiry_date_precision: "day")

      expect(save(:certification, { name: "GCP", issued_date: Date.new(2025, 1, 2) }).value.issued_date_precision).to eq("day")
      expect(save(:certification, { expiry_date_precision: "unknown" }, entry: created)).not_to be_success
    end
  end

  describe "guards" do
    it "refuses an entry that belongs to another user" do
      other_entry = create(:skill)

      expect { save(:skill, { name: "X" }, entry: other_entry) }.to raise_error(ArgumentError, /another user/)
    end

    it "refuses highlights for kinds other than experience" do
      expect { save(:project, { name: "X" }, highlights: [ "a" ]) }.to raise_error(ArgumentError, /experiences/)
    end

    it "refuses an unknown kind" do
      expect { save(:job, { title: "X" }) }.to raise_error(KeyError)
    end
  end
end

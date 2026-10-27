# Exercises posting validation, owned Job reuse, and each task kind's URL provenance.
require "rails_helper"

RSpec.describe Jobs::CreateJobFromPostingService do
  let(:user) { create(:user) }
  let(:url) { "https://www.linkedin.com/jobs/view/1/" }
  let(:worker_url) { "https://example.com/jobs/1" }
  let(:scraped_job) do
    {
      "source_url" => worker_url, "title" => "AI Engineer", "company" => "Acme",
      "location" => "Remote", "description" => "Build agents.",
      "requirements" => [ "Python" ], "responsibilities" => [ "Build agents" ],
      "nice_to_haves" => [ "Rust" ]
    }
  end

  %w[scrape_job parse_job_posting].each do |task_type|
    context "for #{task_type}" do
      let(:ai_task) { create(:ai_task, user: user, task_type: task_type, input: { "url" => url, "text" => "ad" }) }
      let(:saved_url) { task_type == "scrape_job" ? url : worker_url }
      let(:source_label) { task_type == "scrape_job" ? "Scraped job" : "Pasted job" }

      it "saves an unchecked unapplied Job with the correct source URL" do
        result = described_class.call(ai_task: ai_task, scraped_job: scraped_job)

        expect(result).to be_success
        expect(result.value.screened_fields).to be_empty
        expect(result.value).to have_attributes(
          user: user, url: saved_url, title: "AI Engineer", company: "Acme", location: "Remote",
          description: "Build agents.", requirements: [ "Python" ], responsibilities: [ "Build agents" ],
          nice_to_haves: [ "Rust" ], stage: "unapplied"
        )
      end

      it "reuses an owned Job for the URL without overwriting edits" do
        existing_job = create(:job, user: user, url: saved_url, title: "Edited title")

        result = described_class.call(ai_task: ai_task, scraped_job: scraped_job)

        expect(result.value).to eq(existing_job)
        expect(existing_job.reload.title).to eq("Edited title")
        expect(user.jobs.count).to eq(1)
      end

      it "does not reuse another user's Job" do
        existing_job = create(:job, url: saved_url)

        result = described_class.call(ai_task: ai_task, scraped_job: scraped_job)

        expect(result).to be_success
        expect(result.value.user).to eq(user)
        expect(result.value).not_to eq(existing_job)
      end

      it "rejects a posting that is not an object" do
        result = described_class.call(ai_task: ai_task, scraped_job: [ "nope" ])

        expect(result.errors).to eq([ "#{source_label} must be an object" ])
      end

      it "rejects text and list fields with the wrong types" do
        result = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("title" => 5, "requirements" => "Python"))

        expect(result.errors).to eq([ "#{source_label} title must be text", "#{source_label} requirements must be a list of text" ])
        expect(user.jobs).to be_empty
      end

      [ nil, " \t" ].each do |company|
        it "stores company #{company.inspect} as null" do
          result = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("company" => company))

          expect(result).to be_success
          expect(result.value.reload.company).to be_nil
        end
      end

      it "keeps title and field limits enforced" do
        missing_title = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("title" => nil))
        oversized = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("company" => "a" * (TextLimits::SHORT + 1)))

        expect(missing_title.errors).to include("Title can't be blank")
        expect(oversized).not_to be_success
        expect(user.jobs.count).to eq(0)
      end

      if task_type == "parse_job_posting"
        [ nil, "", " \t" ].each do |blank_url|
          it "creates a new URL-less Job for #{blank_url.inspect}, without reusing an existing one" do
            existing_job = create(:job, user: user, url: nil)
            result = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("source_url" => blank_url))

            expect(result).to be_success
            expect(result.value).not_to eq(existing_job)
            expect(result.value.url).to be_nil
            expect(user.jobs.count).to eq(2)
          end
        end

        it "rejects a source URL with the wrong type" do
          result = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("source_url" => 42))

          expect(result.errors).to eq([ "Pasted job source_url must be text" ])
          expect(user.jobs).to be_empty
        end
      else
        it "ignores a malformed worker URL in favor of the canonical task URL" do
          result = described_class.call(ai_task: ai_task, scraped_job: scraped_job.merge("source_url" => 42))

          expect(result).to be_success
          expect(result.value.url).to eq(url)
        end
      end
    end
  end
end

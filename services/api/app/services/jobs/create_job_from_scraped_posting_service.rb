# Description: Saves the Job described by a completed scrape_job task's ScrapedJobPosting
# (services/ai/schemas/scraped_job_posting.py). Runs inside AiTasks::ApplyAiResultService's row
# lock, so a redelivered result can't create the job twice. The Job's url is the task's input url,
# the canonical link StartJobScrapingService checks for duplicates.
# An absent or blank company is stored as null; the title is still required.
# Index:
#   - call: validates the posting's shape and saves the Job; returns it, or error messages
module Jobs
  class CreateJobFromScrapedPostingService < ApplicationService
    TEXT_FIELDS = %w[title company location description].freeze
    LIST_FIELDS = %w[requirements responsibilities nice_to_haves].freeze

    # @param ai_task [AiTask] the scrape_job task (its input holds the canonical url)
    # @param scraped_job [Object] result["scraped_job"] from the worker
    def initialize(ai_task:, scraped_job:)
      @ai_task = ai_task
      @scraped_job = scraped_job
    end

    # Saves a new Job, or returns the user's existing Job for the same URL (two scrapes of one
    # link that raced past the duplicate check).
    def call
      errors = shape_errors
      return failure(errors) if errors.any?

      jobs = @ai_task.user.jobs
      existing_job = jobs.find_by(url: url)
      return success(existing_job) if existing_job

      job = jobs.new(job_attributes)
      job.save ? success(job) : failure(job.errors)
    end

    private

    # The link the user asked to scrape.
    def url
      @ai_task.input["url"]
    end

    # Lists what about the posting's structure can't be saved.
    def shape_errors
      return [ "Scraped job must be an object" ] unless @scraped_job.is_a?(Hash)

      text_errors = TEXT_FIELDS.reject { |name| @scraped_job[name].nil? || @scraped_job[name].is_a?(String) }
                               .map { |name| "Scraped job #{name} must be text" }
      list_errors = LIST_FIELDS.reject { |name| string_list?(@scraped_job.fetch(name, [])) }
                               .map { |name| "Scraped job #{name} must be a list of text" }
      text_errors + list_errors
    end

    # True for an array of strings.
    def string_list?(value)
      value.is_a?(Array) && value.all?(String)
    end

    # Maps the posting onto Job columns.
    def job_attributes
      @scraped_job.slice(*TEXT_FIELDS).merge(
        "company" => @scraped_job["company"].presence,
        "url" => url,
        "requirements" => @scraped_job.fetch("requirements", []),
        "responsibilities" => @scraped_job.fetch("responsibilities", []),
        "nice_to_haves" => @scraped_job.fetch("nice_to_haves", [])
      )
    end
  end
end

# Description: Saves the Job described by a completed parse_job_posting task's ScrapedJobPosting
# (services/ai/schemas/scraped_job_posting.py). Runs inside AiTasks::ApplyAiResultService's row
# lock, so a redelivered result can't create the job twice. The Job's url is the posting's
# source_url when that is present. A blank url is stored as nil and is not used to find an
# existing job.
# Index:
#   - call: validates the posting's shape and saves the Job; returns it, or error messages
module Jobs
  class CreateJobFromPastedPostingService < ApplicationService
    TEXT_FIELDS = %w[title company location description].freeze
    LIST_FIELDS = %w[requirements nice_to_haves].freeze

    # @param ai_task [AiTask] the parse_job_posting task
    # @param scraped_job [Object] result["scraped_job"] from the worker
    def initialize(ai_task:, scraped_job:)
      @ai_task = ai_task
      @scraped_job = scraped_job
    end

    # Saves a new Job, or returns the user's existing Job when the posting names a URL they
    # already saved.
    def call
      errors = shape_errors
      return failure(errors) if errors.any?

      jobs = @ai_task.user.jobs
      existing_job = jobs.find_by(url: url) if url
      return success(existing_job) if existing_job

      job = jobs.new(job_attributes)
      job.save ? success(job) : failure(job.errors)
    end

    private

    # The link extracted from the ad, or nil when the posting has none.
    def url
      source_url = @scraped_job["source_url"]
      source_url.presence
    end

    # Lists what about the posting's structure can't be saved.
    def shape_errors
      return [ "Pasted job must be an object" ] unless @scraped_job.is_a?(Hash)

      text_errors = TEXT_FIELDS.reject { |name| @scraped_job[name].nil? || @scraped_job[name].is_a?(String) }
                               .map { |name| "Pasted job #{name} must be text" }
      list_errors = LIST_FIELDS.reject { |name| string_list?(@scraped_job.fetch(name, [])) }
                               .map { |name| "Pasted job #{name} must be a list of text" }
      url_error = source_url_error
      text_errors + list_errors + url_error
    end

    # source_url is optional text. A missing key is fine.
    def source_url_error
      return [] unless @scraped_job.key?("source_url")
      return [] if @scraped_job["source_url"].nil? || @scraped_job["source_url"].is_a?(String)

      [ "Pasted job source_url must be text" ]
    end

    # True for an array of strings.
    def string_list?(value)
      value.is_a?(Array) && value.all?(String)
    end

    # Maps the posting onto Job columns. A blank link is stored as nil.
    def job_attributes
      @scraped_job.slice(*TEXT_FIELDS).merge(
        "url" => url,
        "requirements" => @scraped_job.fetch("requirements", []),
        "nice_to_haves" => @scraped_job.fetch("nice_to_haves", [])
      )
    end
  end
end

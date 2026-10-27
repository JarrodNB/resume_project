# Saves a pasted or scraped posting as an owned Job when its AI task completes.
# Shared validation and mapping stay here; the task kind chooses the URL's source.
# Runs inside ApplyAiResultService's owner-first transaction so repeated results are safe.
module Jobs
  class CreateJobFromPostingService < ApplicationService
    TEXT_FIELDS = %w[title company location description].freeze
    LIST_FIELDS = %w[requirements responsibilities nice_to_haves].freeze

    # @param ai_task [AiTask] the parse_job_posting or scrape_job task
    # @param scraped_job [Object] result["scraped_job"] from the worker
    def initialize(ai_task:, scraped_job:)
      @ai_task = ai_task
      @scraped_job = scraped_job
    end

    # Returns an existing owned Job for the URL without overwriting user edits,
    # or saves a new Job. URL-less pasted postings always create a new Job.
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

    def pasted?
      @ai_task.parse_job_posting?
    end

    # Scrapes use Rails' canonical task URL, never the worker's extracted link.
    def url
      pasted? ? @scraped_job["source_url"].presence : @ai_task.input["url"]
    end

    def shape_errors
      source = pasted? ? "Pasted job" : "Scraped job"
      return [ "#{source} must be an object" ] unless @scraped_job.is_a?(Hash)

      text_errors = TEXT_FIELDS.reject { |name| @scraped_job[name].nil? || @scraped_job[name].is_a?(String) }
                               .map { |name| "#{source} #{name} must be text" }
      list_errors = LIST_FIELDS.reject { |name| string_list?(@scraped_job.fetch(name, [])) }
                               .map { |name| "#{source} #{name} must be a list of text" }
      text_errors + list_errors + source_url_errors
    end

    def source_url_errors
      return [] unless pasted?
      return [] if @scraped_job["source_url"].nil? || @scraped_job["source_url"].is_a?(String)

      [ "Pasted job source_url must be text" ]
    end

    def string_list?(value)
      value.is_a?(Array) && value.all?(String)
    end

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

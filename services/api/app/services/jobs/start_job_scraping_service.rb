# Description: Queues a scrape_job AI task for a LinkedIn job link. The link is reduced to its
# canonical form (https://www.linkedin.com/jobs/view/<id>/) so tracking parameters and search-page
# links don't create duplicate jobs. The AI worker scrapes the posting with a deterministic
# scraper; Jobs::CreateJobFromPostingService saves the Job when the result arrives.
# Index:
#   - UNSUPPORTED_URL_MESSAGE: shown for links that aren't one LinkedIn job
#   - call: canonicalizes the link, rejects jobs already saved, enqueues; returns the AiTask
module Jobs
  class StartJobScrapingService < ApplicationService
    LINKEDIN_HOST = "linkedin.com".freeze
    # Keep in sync with services/ai/scrapers/linkedin/parse_linkedin_job_url.py.
    JOB_VIEW_PATH = %r{\A/(?:comm/)?jobs/view/(?:[^/]*-)?(?<job_id>\d+)/?\z}
    UNSUPPORTED_URL_MESSAGE = "Paste a LinkedIn job link (linkedin.com/jobs/view/...). " \
                              "Other job sites aren't supported yet".freeze

    def initialize(user:, url:)
      @user = user
      @url = url.to_s.strip
    end

    # Rejects unsupported or already-saved jobs, then enqueues the task with the canonical link.
    def call
      job_id = linkedin_job_id
      return failure([ UNSUPPORTED_URL_MESSAGE ]) unless job_id

      canonical_url = "https://www.linkedin.com/jobs/view/#{job_id}/"
      return failure([ "You already saved this job" ]) if @user.jobs.exists?(url: canonical_url)

      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "scrape_job", input: { url: canonical_url })
    end

    private

    # The job id from /jobs/view/<id>, /jobs/view/<slug>-<id>, or a jobs page's ?currentJobId=<id>.
    def linkedin_job_id
      uri = URI.parse(@url)
      return unless uri.is_a?(URI::HTTP) && linkedin_host?(uri.host)

      JOB_VIEW_PATH.match(uri.path)&.[](:job_id) || selected_job_id(uri)
    rescue URI::InvalidURIError
      nil
    end

    # linkedin.com or any subdomain of it (www., uk., ...).
    def linkedin_host?(host)
      host = host.to_s.downcase
      host == LINKEDIN_HOST || host.end_with?(".#{LINKEDIN_HOST}")
    end

    # The job open on a search or collection page.
    def selected_job_id(uri)
      return unless uri.path.start_with?("/jobs/")

      job_id = URI.decode_www_form(uri.query.to_s).to_h["currentJobId"]
      job_id if job_id&.match?(/\A\d+\z/)
    end
  end
end

# Queue one public job URL. LinkedIn links retain their existing job-ID canonicalization;
# other web links retain meaningful path/query values. Python validates DNS and pins every
# connection before fetching. Rails owns admission, duplicates, usage limits and saving.
require "ipaddr"
module Jobs
  class StartJobScrapingService < ApplicationService
    LINKEDIN_HOST = "linkedin.com".freeze
    # Keep in sync with services/ai/scrapers/linkedin/parse_linkedin_job_url.py.
    JOB_VIEW_PATH = %r{\A/(?:comm/)?jobs/view/(?:[^/]*-)?(?<job_id>\d+)/?\z}
    UNSUPPORTED_URL_MESSAGE = "Paste a public HTTP or HTTPS link to one job posting".freeze

    def initialize(user:, url:)
      @user = user
      @url = url.to_s.strip
    end

    # Rejects unsupported or already-saved jobs, then enqueues the task with the canonical link.
    def call
      canonical_url = canonical_job_url
      return failure([ UNSUPPORTED_URL_MESSAGE ]) unless canonical_url
      return failure([ "You already saved this job" ]) if @user.jobs.exists?(url: canonical_url)

      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "scrape_job", input: { url: canonical_url })
    end

    private

    def canonical_job_url
      return if @url.length > TextLimits::JOB_URL || @url.match?(/[\s\\\x00-\x1f\x7f]/)

      uri = URI.parse(@url)
      return unless uri.is_a?(URI::HTTP) && uri.host.present? && uri.userinfo.nil?
      return unless uri.port == (uri.is_a?(URI::HTTPS) ? 443 : 80)

      host = uri.host.downcase.delete_suffix(".")
      return unless host.include?(".") && !host.end_with?(".localhost", ".local", ".internal", ".test", ".invalid")
      begin
        IPAddr.new(host)
        return # Job sites use DNS names; literal addresses are not admitted.
      rescue IPAddr::InvalidAddressError
        # DNS resolution and address validation happen at the worker fetch boundary.
      end
      if linkedin_host?(host)
        id = linkedin_job_id
        return id ? "https://www.linkedin.com/jobs/view/#{id}/" : nil
      end

      uri.host = host
      uri.fragment = nil
      uri.path = "/" if uri.path.empty?
      uri.to_s
    rescue URI::InvalidURIError, URI::InvalidComponentError
      nil
    end

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

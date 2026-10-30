# Gives an outcome a short safe label and an owned app destination. Destinations are
# resolved at delivery/read time so deleted jobs, sets and interviews lead to an overview.
# `destination_for` is shared with ListRunningTasksService, which links work still in progress.
module AiTasks
  class DescribeTaskOutcomeService < ApplicationService
    LABELS = {
      "elicit_job_preferences" => "Job preferences", "generate_summary" => "Summary draft", "chat_reply" => "Chat reply",
      "check_job_preferences" => "Job preference check", "rerank_job_listings" => "Job reranking", "parse_resume" => "Resume import", "scrape_job" => "Job import", "parse_job_posting" => "Job import",
      "analyze_gaps" => "Gap analysis", "tailor_resume" => "Resume draft", "generate_study_guide" => "Study guide",
      "generate_interview_questions" => "Interview questions", "regenerate_interview_question" => "Question replacement",
      "review_interview_answer" => "Answer feedback", "review_library_section" => "Library review",
      "improve_library_entry" => "Library improvement", "interview_preparation" => "Interview preparation",
      "interview_turn" => "Interview response", "interview_speech" => "Interview audio",
      "interview_session_feedback" => "Interview feedback", "interview_transcription" => "Answer transcription", "interview_clarification" => "Question clarification", "interview_references" => "Career references"
    }.freeze

    # Which job workspace tab shows each job task's result; gap analysis opens the default Fit tab.
    JOB_TABS = { "analyze_gaps" => "", "tailor_resume" => "/resume", "generate_study_guide" => "/study" }.freeze

    # The owned page for a task's work. `status` is the outcome status, or "queued" for work
    # still running (a running job import opens its progress page, like a failed one).
    def self.destination_for(task:, user:, status:)
      new(task: task, user: user, status: status).send(:destination)
    end

    def initialize(outcome: nil, task: nil, user: nil, status: nil)
      @outcome = outcome
      @task = outcome&.ai_task || task
      @user = outcome&.user || user
      @task_type = outcome&.task_type || task.task_type
      @status = outcome&.status || status
    end

    def call
      label = LABELS.fetch(@task_type, "AI task")
      success({ title: "#{label} #{@status == 'completed' ? 'completed' : 'failed'}", destination: destination })
    end

    private

    def destination
      case @task_type
      when "chat_reply"
        conversation = owned_subject("ChatConversation", @user.chat_conversations)
        conversation ? "/chat/#{conversation.id}" : "/chat"
      when "generate_summary"
        return "/library" unless @task.input["target_kind"] == "resume"
        resume = @user.resumes.find_by(id: @task.input["target_id"])
        resume ? (resume.job_id ? "/jobs/#{resume.job_id}/resume" : "/resumes/#{resume.id}") : "/resumes"
      when "elicit_job_preferences", "rerank_job_listings", "check_job_preferences"
        "/jobs/find"
      when "parse_resume"
        "/library/import/#{@task.id}"
      when "scrape_job", "parse_job_posting"
        job = owned_subject("Job", @user.jobs)
        return job ? "/jobs/#{job.id}" : "/jobs" if @status == "completed"
        @task_type == "scrape_job" ? "/jobs/new/#{@task.id}" : "/jobs/paste/#{@task.id}"
      when "analyze_gaps", "tailor_resume", "generate_study_guide"
        job = owned_subject("Job", @user.jobs)
        job ? "/jobs/#{job.id}#{JOB_TABS[@task_type]}" : "/jobs"
      when "generate_interview_questions", "regenerate_interview_question", "review_interview_answer"
        set = if @task.subject_type == "InterviewQuestionSet"
          @user.interview_question_sets.find_by(id: @task.subject_id)
        elsif @task.subject_type == "InterviewQuestion"
          @user.interview_question_sets.joins(:questions).find_by(interview_questions: { id: @task.subject_id })
        end
        set ? "/practice/questions/#{set.id}" : "/practice/questions"
      when *AiTask::SPOKEN_INTERVIEW_TASK_TYPES
        interview = owned_subject("InterviewSession", @user.interview_sessions)
        interview && interview.expires_at > Time.current && !%w[expired abandoned].include?(interview.status) ? "/practice/interviews/#{interview.id}" : "/practice/interviews"
      else
        "/library"
      end
    end

    def owned_subject(type, relation)
      relation.find_by(id: @task.subject_id) if @task.subject_type == type
    end
  end
end

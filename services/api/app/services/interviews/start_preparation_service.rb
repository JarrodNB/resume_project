# Freezes owned career evidence and optional saved-job expectations, then persists preparation.
# Provider calls happen later through the private execution interface, never in this transaction.
module Interviews
  class StartPreparationService < ApplicationService
    SOURCE_FIELDS = {
      experiences: %w[title company description], projects: %w[name role description],
      educations: %w[institution degree field_of_study description], certifications: %w[name issuer description],
      skills: %w[name], career_contexts: %w[response]
    }.freeze
    MAX_CONTEXT_BYTES = 40_000

    def initialize(user:, career_focus: nil, setup: nil, job: nil)
      @user, @career_focus = user, career_focus.to_s.strip
      @job = job
      @setup = setup.nil? ? SetupConfiguration::DEFAULT : (setup.is_a?(Hash) ? SetupConfiguration::DEFAULT.merge(setup.stringify_keys) : setup)
    end

    # @return [ServiceResult<InterviewSession>] preparing session with immutable source snapshot
    def call
      return failure("Choose supported interview settings and 5, 8 or 12 questions") unless SetupConfiguration.valid?(@setup)
      return failure("Career focus must be at most 200 characters") if @career_focus.length > 200
      return failure("Record not found") if @job && @job.user_id != @user.id
      @user.with_lock do
        sources = []
        sources << { type: "profile", id: @user.id, field: "summary", text: @user.summary, screened: @user.screened_fields.include?("summary") } if @user.summary.present?
        SOURCE_FIELDS.each do |association, fields|
          @user.public_send(association).each do |record|
            fields.each do |field|
              value = record[field] if record.has_attribute?(field)
              sources << { type: association.to_s, id: record.id, field: field, text: value, screened: record.screened_fields.include?(field) } if value.is_a?(String) && value.present?
            end
            if association == :experiences
              record.highlights.each do |highlight|
                sources << { type: "highlights", id: highlight.id, field: "content", text: highlight.content, screened: highlight.screened_fields.include?("content") } if highlight.content.present?
              end
            end
          end
        end
        return failure("Your career library is empty. Add career details before preparing an interview.") if sources.empty?
        context = { version: 1, sources: sources, career_focus: @career_focus,
          avoided_questions: InterviewPreferences::AvoidedQuestions.snapshot(@user),
          names: [ @user.name ].compact, emails: [ @user.contact_email ].compact, phones: [ @user.phone ].compact }
        if @job
          @job.with_lock do
            context[:job] = FrozenJobContext.snapshot(@job)
            sources.concat(FrozenJobContext.sources(@job))
          end
        end
        return failure("Your interview sources are too long for preparation. Shorten your job, career library or saved question preferences and try again.") if JSON.generate(context).bytesize > MAX_CONTEXT_BYTES
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @user, interview: true)
        next allowance unless allowance.success?
        interview = @user.interview_sessions.create!(job: @job, status: "preparing", answer_cap: 3, execution_mode: "real",
          execution_config: ExecutionConfiguration::PRESETS.fetch("real"), setup_config: @setup, frozen_context: context, expires_at: 7.days.from_now)
        operation = interview.operations.create!(kind: "preparation")
        operation.update!(ai_task: @user.ai_tasks.create!(task_type: "interview_preparation", subject: interview,
          input: { operation_id: operation.id }))
        ScheduleOperationService.call(operation: operation)
        success(interview)
      end
    rescue ActiveRecord::RecordNotFound, ActiveRecord::InvalidForeignKey
      failure("Record not found")
    end
  end
end

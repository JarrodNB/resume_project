# Freezes only the owner's career evidence, then persists recoverable preparation work.
# Provider calls happen later through the private execution interface, never in this transaction.
module Interviews
  class StartPreparationService < ApplicationService
    SOURCE_FIELDS = {
      experiences: %w[company location description], projects: %w[name role description],
      educations: %w[institution degree field_of_study description], certifications: %w[name issuer description],
      skills: %w[name], library_facts: %w[response]
    }.freeze
    MAX_CONTEXT_BYTES = 40_000

    def initialize(user:, career_focus: nil, setup: nil)
      @user, @career_focus = user, career_focus.to_s.strip
      @setup = setup.nil? ? SetupConfiguration::DEFAULT : (setup.is_a?(Hash) ? SetupConfiguration::DEFAULT.merge(setup.stringify_keys) : setup)
    end

    # @return [ServiceResult<InterviewSession>] preparing session with immutable source snapshot
    def call
      return failure("Choose supported interview settings and 5, 8 or 12 questions") unless SetupConfiguration.valid?(@setup)
      return failure("Career focus must be at most 200 characters") if @career_focus.length > 200
      @user.with_lock do
        # Writers lock entry rows before changing their children. Hold the same rows
        # in ID order so the separate source queries see one coherent committed entry.
        experience_ids = @user.experiences.reorder(:id).lock.map(&:id)
        sources = []
        sources << { type: "profile", id: @user.id, field: "summary", text: @user.summary, screened: @user.screened_fields.include?("summary") } if @user.summary.present?
        SOURCE_FIELDS.each do |association, fields|
          records = @user.public_send(association)
          records = records.where(id: experience_ids) if association == :experiences
          records.each do |record|
            fields.each do |field|
              value = record[field] if record.has_attribute?(field)
              sources << { type: association.to_s, id: record.id, field: field, text: value, screened: record.screened_fields.include?(field) } if value.is_a?(String) && value.present?
            end
            if association == :experiences
              record.roles.order(:position, :id).each do |role|
                %w[title description].each do |field|
                  next if role[field].blank?

                  source = { type: "experience_roles", id: role.id, experience_id: record.id,
                    field: field, text: role[field], screened: role.screened_fields.include?(field) }
                  source.merge!(start_date: role.start_date&.iso8601, end_date: role.end_date&.iso8601) if field == "title"
                  sources << source
                end
              end
              record.highlights.each do |highlight|
                sources << { type: "highlights", id: highlight.id, experience_id: record.id,
                  experience_role_id: highlight.experience_role_id, field: "content", text: highlight.content,
                  screened: highlight.screened_fields.include?("content") } if highlight.content.present?
              end
            end
          end
        end
        return failure("Your career library is empty. Add career details before preparing an interview.") if sources.empty?
        context = { version: 1, sources: sources, career_focus: @career_focus,
          names: [ @user.name ].compact, emails: [ @user.contact_email ].compact, phones: [ @user.phone ].compact }
        return failure("Your career library is too long for interview preparation. Shorten its entries and try again.") if JSON.generate(context).bytesize > MAX_CONTEXT_BYTES
        if @user.interview_sessions.where(status: %w[preparing ready active]).where("expires_at > ?", Time.current)
            .where.not(frozen_context: {}).exists?
          next failure("Resume or abandon your unfinished interview before preparing another.")
        end
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @user, interview: true)
        next allowance unless allowance.success?
        interview = @user.interview_sessions.create!(status: "preparing", answer_cap: 3, execution_mode: "real",
          execution_config: ExecutionConfiguration::PRESETS.fetch("real"), setup_config: @setup, frozen_context: context, expires_at: 7.days.from_now)
        operation = interview.operations.create!(kind: "preparation")
        operation.update!(ai_task: @user.ai_tasks.create!(task_type: "interview_preparation", subject: interview,
          input: { operation_id: operation.id }))
        success(interview)
      end
    end
  end
end

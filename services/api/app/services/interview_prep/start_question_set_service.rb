# Allocates a practice set and queues generation within the AI allowance lock.
# Snapshots bounded recent practice for prompt variety, never answers or feedback.
# Index:
#   - call: creates a numbered set and its task, then publishes after the transaction commits
module InterviewPrep
  class StartQuestionSetService < ApplicationService
    RECENT_QUESTION_LIMIT = 20

    # Receives the authenticated owner.
    def initialize(user:, set_type: "general")
      @user, @set_type = user, set_type
    end

    # Checks usable library presence and queues a set through the shared usage limits.
    def call
      return failure([ "Unknown interview question set type" ]) unless InterviewQuestionSet::SET_TYPES.include?(@set_type)

      associations = [ @user.experiences, @user.projects, @user.educations,
                       @user.certifications, @user.skills, @user.career_contexts ]
      if @user.summary.blank? && associations.none?(&:exists?)
        return failure([ "Your career library is empty. Add career details before generating questions." ])
      end

      AiTasks::EnqueueAiTaskService.call(user: @user, task_type: "generate_interview_questions",
                                        prepare_task: method(:prepare_task))
    end

    private

    # Allocates a number under the existing user lock; retained task inputs prevent number reuse.
    def prepare_task(task)
      previous = @user.ai_tasks.where(task_type: "generate_interview_questions")
                      .maximum(Arel.sql("(input->>'set_number')::integer")).to_i
      number = [ previous, @user.interview_question_sets.maximum(:number).to_i ].max + 1
      question_set = @user.interview_question_sets.create!(number: number, set_type: @set_type)
      task.subject = question_set
      task.input = { "question_set_id" => question_set.id, "set_number" => number, "set_type" => @set_type,
                     "avoided_questions" => InterviewPreferences::AvoidedQuestions.snapshot(@user),
                     "recent_questions" => recent_questions }
      success(task)
    end

    # Rails-generated slots establish provenance; no browser text can supply this history.
    def recent_questions
      @user.interview_question_sets.where(set_type: @set_type).joins(:questions)
        .order("interview_question_sets.created_at DESC", "interview_question_sets.id DESC",
               "interview_questions.position ASC", "interview_questions.id ASC")
        .limit(RECENT_QUESTION_LIMIT).pluck("interview_questions.question_text")
    end
  end
end

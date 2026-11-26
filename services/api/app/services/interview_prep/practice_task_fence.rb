# Owns the "is this written-practice task still current?" rule on the Rails side.
# It builds the durable command saved on a practice AI task (IDs, type, revisions and hashes only),
# and later checks that command against the saved rows when the result comes back.
# Start services build commands here; apply services ask here before saving anything.
# Python re-checks the same command when it reads sources (services/ai/database/interview_questions.py).
# The two sides differ on purpose in a few places; the shared cases in
# services/ai/tests/fixtures/practice_task_fence_cases.json pin both, difference by difference.
# Keeps no state between calls, so it is safe to call for many tasks in a row.
# Index:
#   - build_command: the durable command for one practice task type
#   - stale_reason: nil when the task is current, otherwise a symbol naming the first failed check
#   - latest_task?: whether the task is the newest of its type for its subject
#   - memory_anchor_sha256: the digest stored in anchor commands
module InterviewPrep
  module PracticeTaskFence
    SOURCE_VERSION = 1
    QUESTION_TASK_TYPES = %w[regenerate_interview_question review_interview_answer generate_interview_memory_anchor].freeze
    ACTIVE_SLOT_COUNT = 5

    module_function

    # Builds the command stored on the task. Generation subjects are sets (set_number is required);
    # every other type takes a saved question.
    def build_command(task_type:, subject:, set_number: nil)
      case task_type
      when "generate_interview_questions"
        { "source_version" => SOURCE_VERSION, "question_set_id" => subject.id,
          "set_number" => set_number, "set_type" => subject.set_type }
      when *QUESTION_TASK_TYPES
        build_question_command(task_type, subject)
      else
        raise ArgumentError, "Unknown practice task type: #{task_type}"
      end
    end

    # Returns nil when the task still matches the saved rows, otherwise the first failed check.
    # Each task type keeps its own rules; see the helpers below.
    def stale_reason(task)
      return :unsupported_version unless task.input["source_version"] == SOURCE_VERSION

      case task.task_type
      when "generate_interview_questions" then generation_stale_reason(task)
      when "regenerate_interview_question" then replacement_stale_reason(task)
      when "review_interview_answer" then feedback_stale_reason(task)
      when "generate_interview_memory_anchor" then memory_anchor_stale_reason(task)
      else :unknown_task_type
      end
    end

    # True when no newer task of the same type exists for the task's subject.
    def latest_task?(task)
      subject = task.subject
      return false unless subject

      subject.ai_tasks.where(task_type: task.task_type).order(created_at: :desc, id: :desc).first&.id == task.id
    end

    def memory_anchor_sha256(question)
      Digest::SHA256.hexdigest(question.memory_anchor)
    end

    def build_question_command(task_type, question)
      question_set = question.interview_question_set
      command = {
        "source_version" => SOURCE_VERSION, "set_type" => question_set.set_type,
        "question_id" => question.id, "question_set_id" => question_set.id,
        "question_revision" => question.question_revision, "answer_revision" => question.answer_revision
      }
      if task_type == "regenerate_interview_question"
        command["peer_revisions"] = peer_revisions(question)
      else
        command["answer_format"] = question.answer_format
        command["normalized_answer_sha256"] = ActiveAnswer.fingerprint(question.answer_text)
      end
      command["memory_anchor_sha256"] = memory_anchor_sha256(question) if task_type == "generate_interview_memory_anchor"
      command
    end

    # Generation: the set must still be empty, owned, generated and of the commanded type.
    # Python also checks set_number, which Rails does not.
    def generation_stale_reason(task)
      question_set = task.subject
      return :subject_missing unless question_set
      return :not_latest_task unless latest_task?(task)
      return :wrong_subject unless question_set.is_a?(InterviewQuestionSet) && question_set.user_id == task.user_id
      return :wrong_subject unless question_set.id == task.input["question_set_id"]
      return :set_not_empty unless question_set.questions.empty?
      return :set_not_generated unless question_set.generated?

      :set_type_changed unless question_set.set_type == task.input["set_type"]
    end

    # Replacement: exact question, answer and peer revisions, and still exactly five active slots.
    # Does not check retired_at itself: retiring the target leaves only four active slots.
    def replacement_stale_reason(task)
      question = task.subject
      return :subject_missing unless question
      return :not_latest_task unless latest_task?(task)
      return :wrong_subject unless owned_question?(task, question) && question_in_command?(task, question)
      unless question.question_revision == task.input["question_revision"] &&
             question.answer_revision == task.input["answer_revision"]
        return :revision_changed
      end
      return :peers_changed unless peer_revisions(question) == task.input["peer_revisions"]

      question_set = question.interview_question_set
      return :slot_count_changed unless question_set.questions.count == ACTIVE_SLOT_COUNT
      return :set_not_generated unless question_set.generated?

      :set_type_changed unless question_set.set_type == task.input["set_type"]
    end

    # Feedback: the question revision is exact. Commands with an answer_format must match the answer
    # revision exactly; older commands accept any earlier-or-equal answer revision (coaching stays
    # attributed to the reviewed revision). Retired questions are not rejected here.
    def feedback_stale_reason(task)
      question = task.subject
      return :wrong_subject unless owned_question?(task, question)
      return :set_type_changed unless question.interview_question_set.set_type == task.input["set_type"]
      return :wrong_subject unless question_in_command?(task, question)
      return :revision_changed unless question.question_revision == task.input["question_revision"]
      return :answer_format_changed unless task.input.fetch("answer_format", "plain_text") == question.answer_format

      revision = task.input["answer_revision"]
      return :revision_changed if task.input.key?("answer_format") && revision != question.answer_revision
      return :revision_changed unless revision.is_a?(Integer) && revision >= 0 && revision <= question.answer_revision

      :not_latest_task unless latest_task?(task)
    end

    # Memory anchor: active question, exact revisions, and an unchanged previous cue.
    def memory_anchor_stale_reason(task)
      question = task.subject
      return :wrong_subject unless owned_question?(task, question)
      return :question_retired if question.retired?
      return :wrong_subject unless question_in_command?(task, question)
      return :set_type_changed unless question.interview_question_set.set_type == task.input["set_type"]
      unless question.question_revision == task.input["question_revision"] &&
             question.answer_revision == task.input["answer_revision"]
        return :revision_changed
      end
      return :memory_anchor_changed unless memory_anchor_sha256(question) == task.input["memory_anchor_sha256"]

      :not_latest_task unless latest_task?(task)
    end

    def owned_question?(task, question)
      question.is_a?(InterviewQuestion) && question.interview_question_set.user_id == task.user_id
    end

    def question_in_command?(task, question)
      question.id == task.input["question_id"] &&
        question.interview_question_set_id == task.input["question_set_id"]
    end

    def peer_revisions(question)
      question.interview_question_set.questions.where.not(id: question.id)
              .to_h { |peer| [ peer.id, peer.question_revision ] }
    end

    private_class_method :build_question_command, :generation_stale_reason, :replacement_stale_reason,
                         :feedback_stale_reason, :memory_anchor_stale_reason, :owned_question?,
                         :question_in_command?, :peer_revisions
  end
end

# Selects one owned narrative field and the role context needed to improve it.
# The digest fences both acceptance and follow-up turns against changed career evidence.
module CareerLibrary
  class EditSnapshot
    DISCARD_MESSAGE = "Draft discarded.".freeze
    MAX_TURNS = 8
    MAX_INPUT_BYTES = 180_000

    def self.capture(user:, kind:, record_id:)
      record = case kind
      when "experience" then user.experiences.find(record_id)
      when "experience_highlight" then ExperienceHighlight.joins(:experience).where(experiences: { user_id: user.id }).find(record_id)
      else raise ActiveRecord::RecordNotFound
      end
      role_id = kind == "experience" ? record.id : record.experience_id
      snapshot = ReviewSnapshot.build(user: user, section: "experience", experience_id: role_id)
      target = snapshot["targets"].find { |item| item["kind"] == kind && item["record_id"] == record.id }
      raise ActiveRecord::RecordNotFound unless target

      snapshot.merge("target" => target, "original_text" => record[target["field"]], "targets" => [ target ])
    end

    def self.latest(user:, kind:, record_id:)
      user.ai_tasks.improve_library_entry.where("input -> 'target' ->> 'kind' = ? AND input -> 'target' ->> 'record_id' = ?", kind, record_id.to_s)
        .order(created_at: :desc, id: :desc).first
    end

    def self.stale?(user:, task:)
      target = task.input.fetch("target")
      capture(user: user, kind: target["kind"], record_id: target["record_id"]).dig("target", "source_digest") != target["source_digest"]
    rescue ActiveRecord::RecordNotFound
      true
    end

    def self.discarded?(task)
      task.error_message == DISCARD_MESSAGE
    end
  end
end

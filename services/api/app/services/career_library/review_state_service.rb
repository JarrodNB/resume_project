# Reads the latest owned section review and its last completed grades. Freshness is
# derived from current target content, never from a browser-provided revision flag.
module CareerLibrary
  class ReviewStateService < ApplicationService
    def initialize(user:, section:)
      @user, @section = user, section
    end

    def call
      return success({ ai_task: nil, assessments: [] }) unless ReviewSnapshot::SECTIONS.include?(@section)

      tasks = @user.ai_tasks.review_library_section.where("input ->> 'section' = ?", @section).order(created_at: :desc, id: :desc)
      completed = tasks.completed.first
      current = ReviewSnapshot.build(user: @user, section: @section)["targets"].index_by { |target| ReviewSnapshot.target_key(target) }
      assessments = Array(completed&.result&.dig("assessments")).filter_map do |item|
        target = current[ReviewSnapshot.target_key(item)]
        next unless target

        item.merge("stale" => item["source_digest"] != target["source_digest"])
      end
      accepted = @user.ai_tasks.improve_library_entry.where.not(accepted_at: nil)
        .where("input ->> 'section' = ?", @section).order(accepted_at: :asc, id: :asc)
      accepted = accepted.where("accepted_at > ?", completed.created_at) if completed
      accepted.select(:result).each do |task|
        item = task.result&.dig("assessment")
        next unless item.is_a?(Hash)
        key = ReviewSnapshot.target_key(item)
        target = current[key]
        next unless target
        assessments.reject! { |old| ReviewSnapshot.target_key(old) == key }
        assessments << item.merge("stale" => item["source_digest"] != target["source_digest"])
      end
      success({ ai_task: tasks.first, assessments: assessments })
    end
  end
end

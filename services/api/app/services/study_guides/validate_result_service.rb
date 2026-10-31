# Rejects malformed learning material and late results for deleted jobs.
# Generated output carries only an execution fingerprint, never copied job source text.
module StudyGuides
  class ValidateResultService < ApplicationService
    def initialize(ai_task:, result:)
      @task, @result = ai_task, result
    end

    def call
      job = @task.user.jobs.lock.find_by(id: @task.subject_id) if @task.subject_type == "Job"
      return failure([ "This job no longer exists." ]) unless job && @task.input["job_id"] == job.id
      unless @result.is_a?(Hash) && (@result.keys - %w[study_guide source_description_fingerprint]).empty?
        return failure([ "The AI could not produce a valid study guide. Try again." ])
      end
      fingerprint = @result["source_description_fingerprint"]
      unless fingerprint.is_a?(String) && fingerprint.match?(/\A[0-9a-f]{64}\z/) || @task.input["description"].is_a?(String)
        return failure([ "The study guide source could not be verified. Try again." ])
      end
      guide = @result["study_guide"] if @result.is_a?(Hash)
      return failure([ "The AI could not produce a valid study guide. Try again." ]) unless valid_guide?(guide)
      prompts = guide["questions"].map { |question| QuestionCollection.normalize(question["question"]) }
      previous = QuestionCollection.prompts(job: job, user: @task.user).map { |question| QuestionCollection.normalize(question) }
      if prompts.uniq.size != prompts.size || (prompts & previous).any?
        return failure([ "The AI returned repeated study questions. Your saved questions are unchanged; try generating again." ])
      end
      success(guide)
    end

    private

    def text?(value, limit)
      value.is_a?(String) && value.strip.present? && value.length <= limit
    end

    def valid_diagram?(diagram)
      return true if diagram.nil?
      return false unless diagram.is_a?(Hash) && (diagram.keys - %w[caption explanation nodes edges]).empty? &&
        text?(diagram["caption"], 200) && text?(diagram["explanation"], 1_000)
      nodes, edges = diagram.values_at("nodes", "edges")
      return false unless nodes.is_a?(Array) && nodes.size.between?(2, 6) && edges.is_a?(Array) && edges.size.between?(1, 8)
      return false unless nodes.all? { |node| node.is_a?(Hash) && (node.keys - %w[id label]).empty? && diagram_id?(node["id"]) && text?(node["label"], 160) }
      ids = nodes.map { |node| node["id"] }
      return false unless ids.uniq.size == ids.size
      return false unless edges.all? do |edge|
        edge.is_a?(Hash) && (edge.keys - %w[from_node to_node label]).empty? && text?(edge["label"], 160) &&
          ids.include?(edge["from_node"]) && ids.include?(edge["to_node"]) && edge["from_node"] != edge["to_node"]
      end
      pairs = edges.map { |edge| edge.values_at("from_node", "to_node") }
      pairs.uniq.size == pairs.size && pairs.flatten.uniq.sort == ids.sort
    end

    def diagram_id?(value)
      value.is_a?(String) && value.match?(/\A[a-z][a-z0-9_]{0,31}\z/)
    end

    def valid_guide?(guide)
      guide.is_a?(Hash) && guide["version"] == 1 && text?(guide["title"], 200) && guide["questions"].is_a?(Array) &&
        guide["questions"].size == 5 && guide["questions"].all? do |question|
          question.is_a?(Hash) && text?(question["question"], 1_000) && text?(question["why_it_matters"], 1_000) &&
            text?(question["answer"], 6_000) && text?(question["example"], 3_000) && valid_diagram?(question["diagram"])
        end
    end
  end
end

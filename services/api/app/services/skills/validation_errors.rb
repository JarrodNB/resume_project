# Turns skill validation failures into messages for the library form. Duplicate names
# point to the user's existing skill, keeping its saved capitalization. Other users'
# skills are never consulted, and the normal model messages remain for other errors.
module Skills
  module ValidationErrors
    # @param skill [Skill] the owned skill whose save failed
    # @return [Array<String>] errors suitable for a create or update mutation payload
    def self.messages_for(skill)
      skill.errors.map do |error|
        next error.full_message unless error.attribute == :name && error.type == :taken

        existing_name = skill.user.skills.where.not(id: skill.id)
          .where("LOWER(name) = LOWER(?)", skill.name).pick(:name)
        "You already have a skill called #{existing_name || skill.name}"
      end
    end
  end
end

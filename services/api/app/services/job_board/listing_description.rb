# Reads provider HTML as text and copies bullets only under recognizable headings.
# This mirrors the AI scraper's deterministic extraction without invoking AI.
require "nokogiri"

module JobBoard
  class ListingDescription
    HEADINGS = %w[h1 h2 h3 h4 h5 h6].freeze
    BLOCKS = %w[p div section article blockquote table tr].concat(HEADINGS).freeze
    NICE = /\b(nice[\s-]to[\s-]haves?|bonus|preferred|pluses|plus|extra credit|desirable|ideally|stand out|would be great|added advantage)\b/
    RESPONSIBILITIES = /\b(responsibilit(?:y|ies)|dut(?:y|ies)|what you(?:'ll| will) (?:do|be doing)|day[\s-]to[\s-]day|in this role|the role|your role)\b/
    REQUIREMENTS = /\b(requirements?|qualifications?|what you('ll| will)? bring|you bring|you have|about you|who you are|must[\s-]haves?|look(ing)? for|you('ll| will)? need|you should have|skills|experience|expertise|essential|competenc(y|ies)|ideal candidate|what it takes|what we expect|your background|your profile|is this you)\b/

    def initialize(html)
      @document = Nokogiri::HTML.fragment(html)
      @document.css("script, style").remove
    end

    def sections
      result = { requirements: [], responsibilities: [], nice_to_haves: [] }
      current = nil
      @document.css("*").each do |element|
        if heading?(element)
          heading = clean(element.xpath(".//text()").map(&:text).join(" ")).downcase.tr("’", "'")
          current = if NICE.match?(heading) then :nice_to_haves
          elsif RESPONSIBILITIES.match?(heading) then :responsibilities
          elsif REQUIREMENTS.match?(heading) then :requirements
          end
        elsif element.name == "li" && current
          own_list = element.ancestors.find { |parent| %w[ul ol].include?(parent.name) }
          text = element.xpath(".//text()").select { |node| node.ancestors.find { |parent| %w[ul ol].include?(parent.name) } == own_list }.map(&:text).join
          result[current] << clean(text) if clean(text).present?
        end
      end
      result
    end

    def text
      document = @document.dup
      document.css("br").each { |node| node.replace("\n") }
      document.css("ul, ol").each { |node| node.add_previous_sibling("\n"); node.add_next_sibling("\n") }
      document.css("li").each { |node| node.prepend_child(Nokogiri::XML::Text.new("- ", document.document)); node.add_child(Nokogiri::XML::Text.new("\n", document.document)) }
      document.css(BLOCKS.join(",")).each do |node|
        next if node.ancestors.any? { |parent| parent.name == "li" }
        node.add_previous_sibling("\n\n")
        node.add_next_sibling("\n\n")
      end
      lines = []
      document.text.split("\n").each do |raw|
        line = clean(raw)
        if [ "", "-" ].include?(line)
          lines << "" if lines.any? && lines.last != ""
        else
          lines << "" if lines.last&.start_with?("- ") && !line.start_with?("- ")
          lines << line
        end
      end
      lines.join("\n").strip
    end

    private

    def clean(text)
      text.gsub(/[[:space:]]+/, " ").strip
    end

    def heading?(element)
      return false if element.ancestors.any? { |parent| parent.name == "li" }
      text = clean(element.xpath(".//text()").map(&:text).join(" "))
      return false if text.empty? || text.length > 80
      return true if HEADINGS.include?(element.name)
      return false unless %w[p div].include?(element.name)
      return false if element.at_css((%w[p div ul ol li table] + HEADINGS).join(","))
      bold = clean(element.css("b, strong").map(&:text).join(" "))
      (bold.present? && bold.delete_suffix(":") == text.delete_suffix(":")) || text.end_with?(":")
    end
  end
end

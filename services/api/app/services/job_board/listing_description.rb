# Reads provider HTML as text and copies bullets only under recognizable headings.
# This mirrors the AI scraper's deterministic extraction without invoking AI.
# Rendered block breaks keep words separate in both bullets and saved descriptions.
# Some employers write each section as one "Label: long paragraph" block instead of a
# heading and a list. A short leading label counts as a heading too, and a long duties or
# skills paragraph is split into one bullet per sentence (or semicolon item) so it reads
# like a list.
require "nokogiri"

module JobBoard
  class ListingDescription
    HEADINGS = %w[h1 h2 h3 h4 h5 h6].freeze
    BLOCKS = %w[p div section article blockquote table tr].concat(HEADINGS).freeze
    NICE = /\b(nice[\s-]to[\s-]haves?|bonus|preferred|pluses|plus|extra credit|desirable|ideally|stand out|would be great|added advantage)\b/
    RESPONSIBILITIES = /\b(responsibilit(?:y|ies)|dut(?:y|ies)|what you(?:'ll| will) (?:do|be doing)|day[\s-]to[\s-]day|in this role|the role|your role)\b/
    # A leading "Label: body" with a short, comma-free, digit-free label.
    INLINE_LABEL = /\A([A-Z][^:,.!?;\d]{0,58}):\s+([^[:space:][:lower:]].*)\z/
    INLINE_LABEL_WORDS = 6
    # Inline-labelled list paragraphs with fewer items stay as written.
    SPLIT_MIN_ITEMS = 3
    # Unlisted, inline-labelled paragraphs longer than this move under their own label line.
    LONG_BODY = 200
    # A period after these words does not end a sentence.
    ABBREVIATIONS = %w[e.g i.e etc vs ex inc ltd co corp dr mr mrs ms jr sr st no approx dept].freeze
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
          current = category(heading)
        elsif (labelled = paragraph_label(element)) && (labelled_category = category(labelled.first))
          # The label covers only its own paragraph, not list items that follow it.
          result[labelled_category].concat(list_items(labelled.last))
        elsif element.name == "li" && current
          text = list_item_text(element)
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
        separator = node.ancestors.any? { |parent| parent.name == "li" } ? " " : "\n\n"
        node.add_previous_sibling(separator)
        node.add_next_sibling(separator)
      end
      lines = []
      document.text.split("\n").each do |raw|
        line = clean(raw)
        if [ "", "-" ].include?(line)
          lines << "" if lines.any? && lines.last != ""
        else
          formatted = format_labelled_line(line)
          lines << "" if lines.last&.start_with?("- ") && !formatted.first.start_with?("- ")
          lines.concat(formatted)
        end
      end
      lines.join("\n").strip
    end

    private

    def category(heading)
      heading = heading.downcase.tr("’", "'")
      if NICE.match?(heading) then :nice_to_haves
      elsif RESPONSIBILITIES.match?(heading) then :responsibilities
      elsif REQUIREMENTS.match?(heading) then :requirements
      end
    end

    # Returns [label, body] for a leading "Label: body", or nil.
    def inline_label(text)
      match = INLINE_LABEL.match(text)
      return unless match
      label = match[1].strip
      return if label.split.size > INLINE_LABEL_WORDS || label.count("(") != label.count(")")
      [ label, match[2] ]
    end

    # An inline label on a leaf paragraph outside a list item.
    def paragraph_label(element)
      return unless %w[p div].include?(element.name)
      return if element.ancestors.any? { |parent| parent.name == "li" }
      return if element.at_css((%w[p div ul ol li table br] + HEADINGS).join(","))
      inline_label(clean(element.text))
    end

    # Turns one text line into a label line plus bullets or body, or leaves it alone.
    def format_labelled_line(line)
      return [ line ] if line.start_with?("- ")
      label, body = inline_label(line)
      return [ line ] unless label
      items = list_items(body)
      if category(label) && items.size >= SPLIT_MIN_ITEMS
        [ "#{label}:", *items.map { |item| "- #{item}" } ]
      elsif body.length > LONG_BODY
        [ "#{label}:", body ]
      else
        [ line ]
      end
    end

    # Sentences, or semicolon items when a long list is written as one sentence.
    def list_items(text)
      items = sentences(text)
      return items if items.size >= SPLIT_MIN_ITEMS
      clauses = text.split(/;\s+/)
      clauses.size >= SPLIT_MIN_ITEMS ? clauses.flat_map { |clause| sentences(clause) } : items
    end

    # Splits prose at sentence ends, skipping common abbreviations and initials.
    def sentences(text)
      result = [ +"" ]
      text.split(/(?<=[.!?])\s+/).each do |piece|
        result.last << " " unless result.last.empty?
        result.last << piece
        word = piece.split.last.to_s.downcase.delete_suffix(".")
        sentence_end = piece.match?(/[.!?]\z/) && !ABBREVIATIONS.include?(word.delete("(")) && !word.match?(/\A\(?([a-z]\.)*[a-z]\z/)
        result << +"" if sentence_end
      end
      result.map(&:strip).reject(&:empty?)
    end

    def list_item_text(element)
      item = element.dup
      item.css("ul, ol").remove
      item.css(([ "br" ] + BLOCKS).join(",")).each do |node|
        node.add_previous_sibling(" ")
        node.add_next_sibling(" ")
      end
      clean(item.text)
    end

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

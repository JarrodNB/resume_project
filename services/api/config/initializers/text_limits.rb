# Description: Character and count caps for user-written text, shared by model validations and
# the request-body limit. The AI worker repeats the caps it enforces in services/ai/text_limits.py.
# Oversized text is rejected, not truncated, so a cut-off entry never reaches Jev or a prompt.
# Index:
#   - TextLimits: the caps, the section and request messages, and plain_text / section_too_long?
#   - MaxRequestBody: middleware that answers a body over the cap with a JSON 413
#   - BoundedInput: counts bytes actually read, including a chunked body with no length
module TextLimits
  SHORT = 200
  BULLET = 1_000
  PROSE = 4_000
  JOB_DESCRIPTION = 20_000
  SCREENED_TEXT = 80_000
  MAX_HIGHLIGHTS_PER_ROLE = 40
  MAX_REQUIREMENTS = 80
  MAX_EXPERIENCES = 50
  MAX_PROJECTS = 40
  MAX_EDUCATIONS = 20
  MAX_SKILLS = 80
  MAX_LIBRARY_FACTS = 100
  MAX_LINKS = 20

  SECTION_TOO_LONG = "This section is too long. Shorten it and try again.".freeze
  REQUEST_TOO_LARGE = "This request is too large".freeze

  # Every string nested in a JSON value, joined the same way the worker screens a section.
  def self.plain_text(value)
    parts = []
    walk = lambda do |item|
      case item
      when String then parts << item
      when Hash then item.each_value { |child| walk.call(child) }
      when Array then item.each { |child| walk.call(child) }
      end
    end
    walk.call(value)
    parts.join("\n")
  end

  # True when the strings in a section are over the screen cap.
  def self.section_too_long?(value)
    plain_text(value).length > SCREENED_TEXT
  end
end

# Rejects a request whose Content-Length is over 8 MB before Rails parses the body.
class MaxRequestBody
  MAX_BYTES = 8.megabytes

  def initialize(app)
    @app = app
  end

  # Returns 413 when the declared length or the bytes actually read are over the cap.
  def call(env)
    return too_large if env["CONTENT_LENGTH"].to_i > MAX_BYTES

    env["rack.input"] = BoundedInput.new(env["rack.input"], MAX_BYTES) if env["rack.input"]
    @app.call(env)
  rescue BoundedInput::TooLarge
    too_large
  end

  private

  # A JSON error Apollo can show. The message matches TextLimits::REQUEST_TOO_LARGE.
  def too_large
    body = { errors: [ { message: TextLimits::REQUEST_TOO_LARGE } ] }.to_json
    [ 413, { "content-type" => "application/json" }, [ body ] ]
  end
end

# Wraps the request body and stops once more than `limit` bytes have been read.
class BoundedInput
  class TooLarge < StandardError; end

  def initialize(io, limit)
    @io = io
    @limit = limit
    @read = 0
  end

  # Reads like IO#read, then counts the bytes.
  def read(length = nil, buffer = nil)
    chunk = length.nil? ? @io.read : @io.read(length)
    account(chunk)
    return chunk if buffer.nil?

    buffer.replace(chunk.to_s)
    chunk.nil? ? nil : buffer
  end

  # Reads one line, then counts the bytes.
  def gets(...)
    line = @io.gets(...)
    account(line)
    line
  end

  # Yields each line, counting as it goes.
  def each
    @io.each do |line|
      account(line)
      yield line
    end
  end

  # Lets a legal body be read again. The count starts over with the stream.
  def rewind
    @read = 0
    @io.rewind
  end

  private

  # Adds this chunk to the running total and stops the request once it is over the cap.
  def account(chunk)
    return if chunk.nil?

    @read += chunk.bytesize
    raise TooLarge if @read > @limit
  end
end

Rails.application.config.middleware.insert_before 0, MaxRequestBody

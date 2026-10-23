# Stores DOCX bytes without public routes or signed download URLs.
# Object reads are bounded; a retained database key owns cleanup after any failure.
require "aws-sdk-s3"
module DocumentPageChecks
  class PrivateStorage
    MAX_BYTES = 5.megabytes
    def initialize(client: nil)
      @client = client || Aws::S3::Client.new(region: ENV.fetch("AWS_REGION", "us-east-1"),
        endpoint: ENV["S3_ENDPOINT_URL"], force_path_style: ENV["S3_ENDPOINT_URL"].present?,
        http_open_timeout: 3, http_read_timeout: 5, retry_limit: 0)
      @bucket = ENV.fetch("S3_UPLOADS_BUCKET", "careergrind-uploads")
    end

    def write(key:, bytes:)
      @client.put_object(bucket: @bucket, key: key, body: bytes,
        content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    end

    def read(key)
      bytes = +"".b
      @client.get_object(bucket: @bucket, key: key) do |chunk|
        raise IOError, "Document too large" if bytes.bytesize + chunk.bytesize > MAX_BYTES
        bytes << chunk
      end
      bytes
    end

    def delete(key)
      @client.delete_object(bucket: @bucket, key: key)
    end
  end
end

# Keeps interview objects in a private namespace without Active Storage download routes.
# Executors receive brief object-specific capabilities, never bucket write credentials.
require "aws-sdk-s3"
require "digest"

module Interviews
  class MediaStorage
    MAX_BYTES = Integer(ENV.fetch("INTERVIEW_RECORDING_MAX_BYTES", 10.megabytes.to_s)).clamp(1, 10.megabytes)
    class InvalidObject < StandardError; end

    def initialize(client: nil, browser: false)
      @client = client || Aws::S3::Client.new(region: ENV.fetch("AWS_REGION", "us-east-1"),
        endpoint: ENV["S3_ENDPOINT_URL"], force_path_style: ENV["S3_ENDPOINT_URL"].present?,
        http_open_timeout: 3, http_read_timeout: 5, retry_limit: 0)
      @bucket = ENV.fetch("S3_UPLOADS_BUCKET", "careergrind-uploads")
      @signing_client = if browser
        Aws::S3::Client.new(region: ENV.fetch("AWS_REGION", "us-east-1"),
          endpoint: ENV.fetch("INTERVIEW_BROWSER_STORAGE_ORIGIN", "http://localhost:9090"), force_path_style: true)
      else
        @client
      end
    end

    def upload_url(key:, content_type:, expires_in:, checksum: nil, byte_size: nil)
      options = { bucket: @bucket, key: key, content_type: content_type, expires_in: expires_in }
      options[:content_md5] = checksum if checksum
      options[:content_length] = byte_size if byte_size
      Aws::S3::Presigner.new(client: @signing_client).presigned_url(:put_object, **options)
    end

    def read_url(key:, expires_in:)
      Aws::S3::Presigner.new(client: @signing_client).presigned_url(:get_object, bucket: @bucket, key: key, expires_in: expires_in)
    end

    # Streaming prevents a forged content length from allocating an unbounded body.
    def read(key)
      data = +"".b
      response = @client.get_object(bucket: @bucket, key: key) do |chunk|
        raise InvalidObject, "Audio exceeds byte limit" if data.bytesize + chunk.bytesize > MAX_BYTES
        data << chunk
      end
      raise InvalidObject, "Audio is empty" if data.empty?
      { bytes: data, content_type: response.content_type, checksum: Digest::MD5.base64digest(data), byte_size: data.bytesize }
    end

    def write(key:, bytes:, content_type:, checksum:)
      @client.put_object(bucket: @bucket, key: key, body: bytes, content_type: content_type, content_md5: checksum)
    end

    def delete(key)
      @client.delete_object(bucket: @bucket, key: key) if key.present?
    end
  end
end

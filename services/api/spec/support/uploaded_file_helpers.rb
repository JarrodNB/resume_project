# Description: Builds in-memory uploaded files for specs (no binary fixtures in the repo).
# Index:
#   - build_uploaded_file: an ActionDispatch::Http::UploadedFile with the given bytes and name
#   - minimal_pdf_bytes: bytes that are recognised as a PDF
module UploadedFileHelpers
  # Returns an uploaded file like the one Rails builds from a multipart request.
  def build_uploaded_file(content:, filename:, content_type: "application/octet-stream")
    tempfile = Tempfile.new([ "upload", File.extname(filename) ], binmode: true)
    tempfile.write(content)
    tempfile.rewind
    ActionDispatch::Http::UploadedFile.new(tempfile: tempfile, filename: filename, type: content_type)
  end

  # Returns a tiny PDF (content type detection only looks at the header).
  def minimal_pdf_bytes
    "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
  end
end

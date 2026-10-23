# Exercises package validation and actual isolated DOCX rendering without Rails or a database.
require "spec_helper"
require "tempfile"
require_relative "../../../app/services/service_result"
require_relative "../../../app/services/application_service"
require_relative "../../../app/services/document_page_checks/docx_package_validator"
require_relative "../../../app/services/document_page_checks/libre_office_counter"

RSpec.describe DocumentPageChecks::DocxPackageValidator do
  it "rejects arbitrary bytes before rendering" do
    Tempfile.create([ "invalid", ".docx" ]) do |file|
      file.write("not a ZIP"); file.flush
      expect(described_class.call(path: file.path)).not_to be_success
    end
  end
end

RSpec.describe DocumentPageChecks::LibreOfficeCounter do
  def package(path, body:, extra: {})
    script = <<~'PYTHON'
      import json, sys, zipfile
      with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in json.load(sys.stdin).items(): z.writestr(name, data)
    PYTHON
    files = {
      "[Content_Types].xml" => '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels" => '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/document.xml" => "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>#{body}</w:body></w:document>"
    }.merge(extra)
    require "json"
    _out, error, status = Open3.capture3("python3", "-c", script, path, stdin_data: files.to_json)
    raise error unless status.success?
  end

  it "renders one page and explicit overflow without truncation" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "resume.docx")
      paragraph = '<w:p><w:r><w:t>Readable resume content</w:t></w:r></w:p>'
      package(path, body: paragraph)
      expect(described_class.call(path: path).value).to eq(1)
      package(path, body: [ paragraph, paragraph, paragraph ].join('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'))
      expect(described_class.call(path: path).value).to eq(3)
    end
  end

  it "rejects an external image but permits an HTTPS hyperlink" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "resume.docx")
      relationship = '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/%s" TargetMode="External" Target="https://example.com/a"/></Relationships>'
      package(path, body: "", extra: { "word/_rels/document.xml.rels" => relationship % "image" })
      expect(DocumentPageChecks::DocxPackageValidator.call(path: path)).not_to be_success
      package(path, body: "", extra: { "word/_rels/document.xml.rels" => relationship % "hyperlink" })
      expect(DocumentPageChecks::DocxPackageValidator.call(path: path)).to be_success
    end
  end

  it "rejects macros and inflated packages" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "resume.docx")
      package(path, body: "", extra: { "word/vbaProject.bin" => "macro" })
      expect(DocumentPageChecks::DocxPackageValidator.call(path: path)).not_to be_success
      package(path, body: "x" * (11 * 1024 * 1024))
      expect(DocumentPageChecks::DocxPackageValidator.call(path: path)).not_to be_success
    end
  end

  it "rejects dynamic Word fields and relationship traversal outside the package" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "resume.docx")
      [ '<w:p><w:r><w:instrText>INCLUDE</w:instrText></w:r><w:r><w:instrText>TEXT /etc/passwd</w:instrText></w:r></w:p>',
        '<w:fldSimple w:instr="INCLUDEPICTURE file:///etc/passwd"/>' ].each do |body|
        package(path, body: body)
        expect(DocumentPageChecks::DocxPackageValidator.call(path: path)).not_to be_success
      end
      [ "../../../../etc/passwd", "/etc/passwd", "%2e%2e/%2e%2e/etc/passwd" ].each do |target|
        relationship = "<Relationships><Relationship Type=\"image\" Target=\"#{target}\"/></Relationships>"
        package(path, body: "", extra: { "word/_rels/document.xml.rels" => relationship })
        expect(DocumentPageChecks::DocxPackageValidator.call(path: path)).not_to be_success
      end
    end
  end

  it "prevents internet sockets in the actual child sandbox" do
    script = "import socket; socket.socket(socket.AF_INET, socket.SOCK_STREAM)"
    _out, _error, status = Open3.capture3("/usr/local/bin/docx-network-sandbox", "python3", "-c", script)
    expect(status).not_to be_success
  end
end

RSpec.describe "DOCX process isolation" do
  it "clears secrets, times out the process group, and removes temporary files" do
    Dir.mktmpdir do |dir|
      path = File.join(dir, "input.docx")
      File.write(path, "validated at the package seam")
      allow(DocumentPageChecks::DocxPackageValidator).to receive(:call).and_return(ServiceResult.new(success: true, value: true, errors: []))
      stub_const("DocumentPageChecks::LibreOfficeCounter::TIMEOUT_SECONDS", 1)
      output = File.join(dir, "observed.txt")
      child = File.join(dir, "child.pid")
      ENV["DOCX_TEST_SECRET"] = "private"
      render_directory = nil
      script = "File.write(ARGV[0], ENV.fetch('DOCX_TEST_SECRET', 'absent')); descendant = fork { sleep 60 }; File.write(ARGV[1], [Process.pid, descendant].join(',')); sleep 60"
      allow(Process).to receive(:spawn).and_wrap_original do |original, environment, *_command, **options|
        render_directory = options[:chdir]
        original.call(environment, RbConfig.ruby, "-e", script, output, child, **options)
      end
      result = DocumentPageChecks::LibreOfficeCounter.call(path: path)
      expect(result).not_to be_success
      expect(File.read(output)).to eq("absent")
      expect(File.directory?(render_directory)).to be(false)
      parent_pid, descendant_pid = File.read(child).split(",").map(&:to_i)
      expect { Process.kill(0, parent_pid) }.to raise_error(Errno::ESRCH)
      descendant_status = "/proc/#{descendant_pid}/stat"
      expect(File.exist?(descendant_status) ? File.read(descendant_status).split[2] : "gone").to satisfy { |state| [ "Z", "gone" ].include?(state) }
    ensure
      ENV.delete("DOCX_TEST_SECRET")
    end
  end
end

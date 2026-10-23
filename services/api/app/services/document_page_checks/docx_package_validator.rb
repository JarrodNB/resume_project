# Checks bounded DOCX packages before LibreOffice sees them. Embedded objects, macros,
# external resources and unusually large expanded ZIPs are rejected without extraction.
require "open3"

module DocumentPageChecks
  class DocxPackageValidator < ApplicationService
    MAX_BYTES = 5 * 1024 * 1024
    SCANNER = <<~'PYTHON'
      import sys, zipfile, xml.etree.ElementTree as ET, re
      try:
        with zipfile.ZipFile(sys.argv[1]) as archive:
          entries = archive.infolist()
          assert len(entries) <= 512
          assert sum(e.file_size for e in entries) <= 20 * 1024 * 1024
          names = [e.filename for e in entries]
          assert len(set(names)) == len(names)
          assert '[Content_Types].xml' in names and 'word/document.xml' in names
          for e in entries:
            name = e.filename.lower()
            assert not e.flag_bits & 1
            assert not name.startswith('/') and '\\' not in name and '..' not in name.split('/')
            assert not any(x in name for x in ['vbaproject', 'embeddings/', 'activex/', 'altchunk'])
            assert e.file_size <= 10 * 1024 * 1024
            assert e.file_size <= max(e.compress_size * 200, 1024 * 1024)
            data = archive.read(e)
            if name.endswith(('.xml', '.rels')):
              assert b'<!DOCTYPE' not in data.upper() and b'<!ENTITY' not in data.upper()
              root = ET.fromstring(data)
              for node in root.iter():
                tag = node.tag.rsplit('}', 1)[-1].lower()
                assert tag not in ['altchunk', 'oleobject', 'object']
                for value in node.attrib.values():
                  assert not any(x in value.lower() for x in ['macroenabled', 'vbaproject', 'oleobject', '/afchunk'])
                if tag == 'relationship' and node.get('TargetMode', '').lower() != 'external':
                  target = node.get('Target', '')
                  assert not re.match(r'^[a-z][a-z0-9+.-]*:', target, re.I) and not target.startswith(('//', '\\'))
                if tag == 'relationship' and node.get('TargetMode', '').lower() == 'external':
                  assert node.get('Type', '').endswith('/hyperlink')
                  assert re.match(r'^(https?://|mailto:)', node.get('Target', ''), re.I)
        sys.exit(0)
      except Exception:
        sys.exit(1)
    PYTHON

    def initialize(path:)
      @path = path
    end

    # @return [ServiceResult] whether the local package can be rendered safely
    def call
      return failure("Invalid DOCX package") unless File.file?(@path) && File.size(@path).between?(1, MAX_BYTES)
      _out, _err, status = Open3.capture3({ "PATH" => "/usr/bin:/bin" }, "python3", "-I", "-c", SCANNER, @path.to_s,
        unsetenv_others: true, rlimit_cpu: 5, rlimit_as: 256 * 1024 * 1024)
      status.success? ? success(true) : failure("Invalid DOCX package")
    rescue SystemCallError, IOError
      failure("DOCX validation unavailable")
    end
  end
end

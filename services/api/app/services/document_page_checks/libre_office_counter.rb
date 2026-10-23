# Renders a validated DOCX in a disposable private directory and counts its PDF pages.
# Child processes inherit no application secrets and cannot open internet sockets.
require "tmpdir"
require "fileutils"
require "timeout"

module DocumentPageChecks
  class LibreOfficeCounter < ApplicationService
    TIMEOUT_SECONDS = 30

    def initialize(path:)
      @path = path
    end

    # @return [ServiceResult<Integer>] LibreOffice page count, or a nonblocking failure
    def call
      validation = DocxPackageValidator.call(path: @path)
      return validation unless validation.success?

      Dir.mktmpdir("docx-pages-") do |directory|
        FileUtils.cp(@path, File.join(directory, "resume.docx"))
        environment = { "PATH" => "/usr/bin:/bin", "HOME" => directory, "TMPDIR" => directory, "LANG" => "C.UTF-8" }
        render = run(environment, directory, "/usr/local/bin/docx-network-sandbox", "/usr/bin/libreoffice",
          "-env:UserInstallation=file://#{directory}/profile", "--headless", "--convert-to", "pdf", "--outdir", directory,
          File.join(directory, "resume.docx"))
        return failure("DOCX page check unavailable") unless render && File.file?(File.join(directory, "resume.pdf"))

        run(environment, directory, "/usr/bin/pdfinfo", File.join(directory, "resume.pdf"), output: File.join(directory, "pages.txt"))
        pages = File.read(File.join(directory, "pages.txt")).match(/^Pages:\s+(\d+)$/)&.captures&.first.to_i
        pages.positive? ? success(pages) : failure("DOCX page check unavailable")
      end
    rescue SystemCallError, IOError, Timeout::Error
      failure("DOCX page check unavailable")
    end

    private

    def run(environment, directory, *command, output: File::NULL)
      pid = Process.spawn(environment, *command, unsetenv_others: true, chdir: directory, pgroup: true,
        in: File::NULL, out: output, err: File::NULL, close_others: true,
        rlimit_cpu: TIMEOUT_SECONDS, rlimit_as: 1536 * 1024 * 1024, rlimit_fsize: 30 * 1024 * 1024, rlimit_nofile: 128)
      Timeout.timeout(TIMEOUT_SECONDS) { Process.waitpid(pid) }
      $?.success?
    ensure
      if pid
        begin
          Process.kill("KILL", -pid)
        rescue Errno::ESRCH
          # The complete process group already exited.
        end
        begin
          Process.waitpid(pid)
        rescue Errno::ECHILD
          # Already reaped after normal completion.
        end
      end
    end
  end
end

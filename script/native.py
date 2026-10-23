#!/usr/bin/env python3
"""Install and run Careergrind without Docker on a Debian/Ubuntu development host.

Dependencies and process state stay in .native. PostgreSQL data persists there;
Moto emulates SQS and S3 in memory. This is a development environment, not hosting.
"""

import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".native"
RUBY = "3.4.11"
PORT = "55432"
PACKAGES = [
    "build-essential", "git", "curl", "ca-certificates", "pkg-config",
    "libssl-dev", "libyaml-dev", "libreadline-dev", "zlib1g-dev", "libffi-dev",
    "libgmp-dev", "libpq-dev", "postgresql-17", "postgresql-17-pgvector", "ffmpeg",
]


def run(args, cwd=ROOT, env=None, **kwargs):
    print("+", " ".join(map(str, args)), flush=True)
    return subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True, **kwargs)


def environment():
    env = os.environ.copy()
    env["PATH"] = f"{STATE}/ruby/bin:/usr/lib/postgresql/17/bin:" + env.get("PATH", os.defpath)
    env["BUNDLE_PATH"] = str(STATE / "bundle")
    env["UV_PROJECT_ENVIRONMENT"] = str(ROOT / "services/ai/.venv")
    env["UV_PYTHON"] = "3.13"
    # Preserve the session proxy and extend its local-service bypass list.
    bypass = env.get("NO_PROXY", env.get("no_proxy", ""))
    env["NO_PROXY"] = env["no_proxy"] = bypass + ",localhost,127.0.0.1,::1"
    # Python/uv replace trust roots; the managed system bundle includes public roots.
    if env.get("CODEX_PROXY_CERT"):
        env.setdefault("SSL_CERT_FILE", "/etc/ssl/certs/ca-certificates.crt")
        env.setdefault("REQUESTS_CA_BUNDLE", "/etc/ssl/certs/ca-certificates.crt")
        env.setdefault("NODE_EXTRA_CA_CERTS", env["CODEX_PROXY_CERT"])
    return env


def require_tools(env, tools):
    missing = [tool for tool in tools if not shutil.which(tool, path=env["PATH"])]
    if missing:
        raise RuntimeError("Missing tools: " + ", ".join(missing)
                           + ". See docs/native-development.md for prerequisites.")


def config():
    path = STATE / "config.json"
    if not path.exists():
        STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
        value = {"database_password": secrets.token_hex(24),
                 "reader_password": secrets.token_hex(24),
                 "interview_secret": secrets.token_hex(32)}
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
            json.dump(value, stream)
    return json.loads(path.read_text())


def app_env(service):
    env = environment()
    # Never let inherited Rails URLs redirect native db:prepare to another database.
    for key in ("DATABASE_URL", "PRIMARY_DATABASE_URL", "CABLE_DATABASE_URL"):
        env.pop(key, None)
    cfg = config()
    web_origin = env.get("NATIVE_WEB_ORIGIN", "http://localhost:5173")
    env.update({
        "AWS_REGION": "us-east-1", "AWS_ACCESS_KEY_ID": "local",
        "AWS_SECRET_ACCESS_KEY": "local", "AWS_EC2_METADATA_DISABLED": "true",
        "SQS_ENDPOINT_URL": "http://127.0.0.1:9090",
        "S3_ENDPOINT_URL": "http://127.0.0.1:9090",
        "S3_UPLOADS_BUCKET": "careergrind-uploads", "DB_HOST": "127.0.0.1",
        "PGPORT": PORT, "DB_PORT": PORT, "DB_NAME": "api_development",
        "DB_USERNAME": "postgres", "DB_PASSWORD": cfg["database_password"],
        "PGPASSWORD": cfg["database_password"], "RAILS_ENV": "development",
        "DATABASE_URL": f"postgresql://postgres:{cfg['database_password']}@127.0.0.1:{PORT}/api_development",
        "CABLE_DATABASE_URL": f"postgresql://postgres:{cfg['database_password']}@127.0.0.1:{PORT}/api_development_cable",
        "WORKER_ENVIRONMENT": "local", "LOGFIRE_ENVIRONMENT": "native-development",
        "CORS_ORIGINS": web_origin, "WEB_APP_URL": web_origin,
        "VITE_API_URL": env.get("NATIVE_API_ORIGIN", "http://localhost:3000"),
        "RAILS_DEVELOPMENT_HOSTS": urlsplit(env.get(
            "NATIVE_API_ORIGIN", "http://localhost:3000")).hostname or "localhost",
        "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS": urlsplit(web_origin).hostname or "localhost",
        "INTERVIEW_SERVICE_SECRET": cfg["interview_secret"],
        "INTERVIEW_RAILS_ORIGIN": "http://127.0.0.1:3000",
        "INTERVIEW_REAL_RUNTIME_ENABLED": "true",
        "INTERVIEW_ENVIRONMENT": "development",
        "INTERVIEW_BROWSER_ORIGINS": web_origin,
        "INTERVIEW_STORAGE_ORIGINS": "http://127.0.0.1:9090",
        "INTERVIEW_BROWSER_STORAGE_ORIGIN": env.get(
            "NATIVE_STORAGE_ORIGIN", "http://localhost:9090"),
        "INTERVIEW_TRANSCRIPTION_TARGET": "http://127.0.0.1:8000",
    })
    if service == "ai":
        env.update(DB_USERNAME="ai_reader", DB_PASSWORD=cfg["reader_password"])
    return env


def install():
    if os.geteuid() == 0:
        raise RuntimeError("Run install as your normal user; PostgreSQL cannot run as root.")
    env = environment()
    require_tools(env, ["git", "curl", "make", "cc", "node", "npm", "uv",
                        "initdb", "pg_ctl", "psql", "postgres", "pg_config", "ffmpeg"])
    version = subprocess.check_output(["postgres", "--version"], env=env, text=True)
    if not version.split()[2].startswith("17."):
        raise RuntimeError("PostgreSQL 17 is required; found " + version.strip())
    node = subprocess.check_output(["node", "--version"], env=env, text=True)
    if int(node.lstrip("v").split(".")[0]) < 22:
        raise RuntimeError("Node 22 or newer is required.")
    shared = subprocess.check_output(["pg_config", "--sharedir"], env=env, text=True).strip()
    if not (Path(shared) / "extension/vector.control").is_file():
        raise RuntimeError("Install the PostgreSQL 17 pgvector extension first.")
    config()
    for service in ("api", "ai"):
        target = ROOT / f"services/{service}/.env"
        if not target.exists():
            with os.fdopen(os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as stream:
                stream.write(target.with_name(".env.example").read_text())
    if not (STATE / "ruby/bin/ruby").exists():
        builder = STATE / "ruby-build"
        if not builder.exists():
            run(["git", "clone", "--depth", "1", "https://github.com/rbenv/ruby-build.git",
                 builder], env=env)
        run([builder / "bin/ruby-build", RUBY, STATE / "ruby"], env=env)
    run(["ruby", "-e", f'abort "Expected Ruby {RUBY}" unless RUBY_VERSION == "{RUBY}"'], env=env)
    # Match the lockfile's Bundler version rather than the host default.
    lock = (ROOT / "services/api/Gemfile.lock").read_text()
    bundler = lock.split("BUNDLED WITH\n", 1)[1].strip().splitlines()[0].strip()
    run(["gem", "install", "bundler", "--version", bundler, "--no-document"], env=env)
    run(["bundle", "install"], cwd=ROOT / "services/api", env=env)
    run(["uv", "python", "install", "3.13"], env=env)
    run(["uv", "sync", "--frozen"], cwd=ROOT / "services/ai", env=env)
    run(["uv", "run", "--no-sync", "python", "-c",
         "import spacy; spacy.load('en_core_web_sm')"], cwd=ROOT / "services/ai", env=env)
    if not (STATE / "emulators/bin/python").exists():
        run(["uv", "venv", "--python", "3.13", STATE / "emulators"], env=env)
    run(["uv", "pip", "install", "--python", STATE / "emulators/bin/python",
         "moto[server]==5.1.14"], env=env)
    for app in ("web", "landing"):
        run(["npm", "ci"], cwd=ROOT / f"apps/{app}", env=env)
    print("Installed. Run: python3 script/native.py start")


def wait_port(port, timeout=60):
    import socket
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return
        except OSError:
            time.sleep(0.5)
    raise RuntimeError(f"Port {port} did not become ready; inspect .native/logs.")


def spawn(name, args, cwd, env):
    pidfile = STATE / f"{name}.pid"
    if pidfile.exists():
        raise RuntimeError(f"{name} has a PID file. Run stop before starting again.")
    logs = STATE / "logs"
    logs.mkdir(exist_ok=True)
    with (logs / f"{name}.log").open("ab") as log:
        proc = subprocess.Popen(list(map(str, args)), cwd=cwd, env=env,
                                stdout=log, stderr=log, stdin=subprocess.DEVNULL,
                                start_new_session=True)
    pidfile.write_text(json.dumps({"pid": proc.pid, "started": process_start(proc.pid)}))
    print(f"Started {name}; log: {logs / (name + '.log')}", flush=True)
    return proc


def prepare_database(env):
    data = STATE / "postgres"
    if not data.exists():
        password = STATE / "postgres-password"
        with os.fdopen(os.open(password, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as stream:
            stream.write(config()["database_password"])
        try:
            run(["initdb", "-D", data, "-U", "postgres", "--auth-local=trust",
                 "--auth-host=scram-sha-256", f"--pwfile={password}"], env=env)
        finally:
            password.unlink(missing_ok=True)
    run(["pg_ctl", "-D", data, "-l", STATE / "logs/postgres.log",
         "-o", f"-h 127.0.0.1 -p {PORT} -k {STATE}", "-w", "start"], env=env)
    cfg = config()
    # Passwords are generated hex values, never shell input. Do not print SQL.
    sql = ("SELECT 'CREATE ROLE ai_reader LOGIN' WHERE NOT EXISTS "
           "(SELECT FROM pg_roles WHERE rolname = 'ai_reader')\\gexec\n"
           f"ALTER ROLE ai_reader PASSWORD '{cfg['reader_password']}';\n")
    run(["psql", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres",
         "-v", "ON_ERROR_STOP=1", "-q"], env=env, input=sql, text=True,
        stdout=subprocess.DEVNULL)
    run(["bundle", "exec", "rails", "db:prepare"], cwd=ROOT / "services/api", env=env)


def start():
    if not (STATE / "emulators/bin/moto_server").exists():
        raise RuntimeError("Run install first.")
    if list(STATE.glob("*.pid")) or (STATE / "postgres/postmaster.pid").exists():
        raise RuntimeError("Native services have PID files. Run stop first.")
    # Refuse occupied ports instead of accidentally using another stack's database/storage.
    import socket
    for port in (int(PORT), 9090, 3000, 8000, 5173, 5174):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", port))
    env = app_env("api")
    (STATE / "logs").mkdir(exist_ok=True)
    try:
        spawn("emulators", [STATE / "emulators/bin/moto_server", "-H", "127.0.0.1",
                            "-p", "9090"], ROOT, env)
        wait_port(9090)
        run([STATE / "emulators/bin/python", "-c", """
import boto3
endpoint = 'http://127.0.0.1:9090'
sqs = boto3.client('sqs', endpoint_url=endpoint)
for name, visibility in [('ai_tasks', '300'), ('ai_results', '60')]:
    dead = sqs.create_queue(QueueName=name + '_dead_letters')['QueueUrl']
    arn = sqs.get_queue_attributes(QueueUrl=dead, AttributeNames=['QueueArn'])['Attributes']['QueueArn']
    import json
    sqs.create_queue(QueueName=name, Attributes={
        'VisibilityTimeout': visibility, 'ReceiveMessageWaitTimeSeconds': '20',
        'RedrivePolicy': json.dumps({'deadLetterTargetArn': arn, 'maxReceiveCount': '3'})})
s3 = boto3.client('s3', endpoint_url=endpoint)
s3.create_bucket(Bucket='careergrind-uploads')
import os
s3.put_bucket_cors(Bucket='careergrind-uploads', CORSConfiguration={'CORSRules': [{
    'AllowedOrigins': [os.environ['WEB_APP_URL']], 'AllowedHeaders': ['*'],
    'AllowedMethods': ['GET', 'PUT', 'POST', 'HEAD'], 'ExposeHeaders': ['ETag']}]})
"""], env=env)
        prepare_database(env)
        commands = {
            "api": (["bundle", "exec", "rails", "server", "-b", "0.0.0.0", "-p", "3000"], "services/api", env),
            "results": (["bundle", "exec", "shoryuken", "-R", "-C", "config/shoryuken.yml"], "services/api", env),
            "ai": (["uv", "run", "--no-sync", "--env-file", ".env", "python", "-m", "worker.main"], "services/ai", app_env("ai")),
            "interview": (["uv", "run", "--no-sync", "--env-file", ".env", "uvicorn", "interviews.real_app:app", "--host", "0.0.0.0", "--port", "8000"], "services/ai", env),
            "web": (["npm", "run", "dev", "--", "--host", "0.0.0.0"], "apps/web", env),
            "landing": (["npm", "run", "dev", "--", "--host", "0.0.0.0"], "apps/landing", env),
        }
        processes = []
        for name, (args, cwd, child_env) in commands.items():
            processes.append((name, spawn(name, args, ROOT / cwd, child_env)))
            if name == "api":
                wait_port(3000, timeout=120)
        for port in (8000, 5173, 5174):
            wait_port(port)
        time.sleep(2)
        for name, proc in processes:
            if proc.poll() is not None:
                raise RuntimeError(f"{name} exited; inspect .native/logs/{name}.log")
        check()
    except BaseException:
        stop()
        raise


def process_start(pid):
    """Linux start ticks identify a process even if the OS later reuses its PID."""
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
    except FileNotFoundError:
        return None


def stop():
    # Only stop process groups started by this checkout. Never use pkill by name.
    for path in STATE.glob("*.pid"):
        record = json.loads(path.read_text())
        pid = record["pid"]
        if process_start(pid) != record["started"]:
            print(f"Removing stale {path.name}; process identity changed.")
            path.unlink()
            continue
        try:
            # Linux start_new_session makes the child its own process-group leader.
            cmdline = Path(f"/proc/{pid}/cwd")
            if not cmdline.exists():
                path.unlink()
                continue
            if not Path(os.readlink(cmdline)).is_relative_to(ROOT):
                raise RuntimeError(f"Refusing to stop unrelated process {pid}")
            os.killpg(pid, signal.SIGTERM)
            for _ in range(50):
                try:
                    os.killpg(pid, 0)
                except ProcessLookupError:
                    break
                time.sleep(0.1)
            else:
                os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        path.unlink()
    if (STATE / "postgres/postmaster.pid").exists():
        run(["pg_ctl", "-D", STATE / "postgres", "-m", "fast", "-w", "stop"],
            env=environment())


def check():
    # HTTP requests stay local and never invoke a model or enqueue AI work.
    for name, url in (("API", "http://127.0.0.1:3000/up"),
                      ("web", "http://127.0.0.1:5173"),
                      ("landing", "http://127.0.0.1:5174")):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url, timeout=10) as response:
            print(f"{name}: HTTP {response.status}")
    for port in (9090, 8000, int(PORT)):
        wait_port(port, timeout=2)
        print(f"Port {port}: reachable")


def doctor():
    env = environment()
    for tool in ("node", "npm", "uv", "cc", "make", "ruby", "bundle",
                 "initdb", "pg_ctl", "psql", "pg_config", "ffmpeg"):
        print(f"{tool}: {shutil.which(tool, path=env['PATH']) or 'MISSING'}")
    print("Data directory:", STATE)
    print("Free disk GiB:", round(shutil.disk_usage(ROOT).free / 2**30, 1))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["system-deps", "install", "start", "stop", "check", "doctor"])
    args = parser.parse_args()
    if args.command == "system-deps":
        if os.geteuid() != 0:
            raise RuntimeError("Run system-deps as root on Debian 13 (or use the package list in the guide).")
        run(["apt-get", "update"])
        run(["apt-get", "install", "-y", "--no-install-recommends", *PACKAGES])
    else:
        globals()[args.command]()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Native setup failed: {error}", file=sys.stderr)
        sys.exit(1)

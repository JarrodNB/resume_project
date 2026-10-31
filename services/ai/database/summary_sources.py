"""Read current owned evidence for summaries without storing or transporting copies.

The command's field identities and hashes must match before screening or generation.
Resume trust comes only from exact accepted generated prose in a narrow database view.
"""
import hashlib
import json

from psycopg import IsolationLevel
from psycopg.pq import TransactionStatus

from database.open_read_only_connection import open_read_only_connection
from schemas.summary_generation import SummaryGenerationInput

LIBRARY_FIELDS = {
    "experiences": ["company", "title", "location", "description"],
    "projects": ["name", "role", "description"],
    "educations": ["institution", "degree", "field_of_study", "description"],
    "certifications": ["name", "issuer", "description"],
    "skills": ["name", "category"], "career_contexts": ["response"],
}
RESUME_FIELDS = {
    "experience": ["company", "title", "location", "start_date", "end_date", "description"],
    "projects": ["name", "role", "start_date", "end_date", "description"],
    "education": ["institution", "degree", "field_of_study", "start_date", "end_date", "description"],
    "certifications": ["name", "issuer", "issued_date", "expiry_date", "description"],
    "skills": ["name", "category"],
}


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _fingerprint(value):
    return hashlib.sha256(_json(value).encode()).hexdigest()


def _profile_sources(connection, user_id):
    user = connection.execute("SELECT summary FROM users WHERE id = %(user_id)s", {"user_id": user_id}).fetchone()
    if user is None or (user["summary"] and user["summary"].strip()):
        return None
    # One owned query for all highlights; more than 1000 can never fit the source cap anyway.
    highlights = {}
    for highlight in connection.execute("""
        SELECT h.id::text, h.experience_id::text, h.content, h.screened_fields FROM experience_highlights h
        JOIN experiences e ON e.id = h.experience_id
        WHERE e.user_id = %(user_id)s ORDER BY h.experience_id, h.id LIMIT 1001
    """, {"user_id": user_id}).fetchall():
        highlights.setdefault(highlight["experience_id"], []).append(highlight)
    sources = []
    for table, fields in LIBRARY_FIELDS.items():
        # Tables/columns are fixed constants; values stay bound and every row is owned.
        rows = connection.execute(
            f"SELECT id::text, screened_fields, {', '.join(fields)} FROM {table} "
            "WHERE user_id = %(user_id)s ORDER BY id LIMIT 1001", {"user_id": user_id}).fetchall()
        for index, row in enumerate(rows, 1):
            for field in fields:
                if isinstance(row[field], str) and row[field].strip():
                    sources.append({"label": f"{table.upper()}_{index}_{field.upper()}", "text": row[field],
                                    "screened": field in row["screened_fields"], "record_id": row["id"]})
            if table == "experiences":
                for position, highlight in enumerate(highlights.get(row["id"], []), 1):
                    sources.append({"label": f"EXPERIENCES_{index}_HIGHLIGHT_{position}",
                                    "text": highlight["content"], "screened": "content" in highlight["screened_fields"],
                                    "record_id": highlight["id"]})
    return sources


def _resume_sources(connection, user_id, resume_id):
    params = {"user_id": user_id, "resume_id": resume_id}
    if not connection.execute("SELECT id FROM resumes WHERE user_id = %(user_id)s AND id = %(resume_id)s", params).fetchone():
        return None
    sections = connection.execute("""
        SELECT s.id::text, s.section_type, s.content FROM resume_sections s
        JOIN resumes r ON r.id = s.resume_id
        WHERE r.user_id = %(user_id)s AND r.id = %(resume_id)s ORDER BY s.position, s.id LIMIT 1001
    """, params).fetchall()
    sources, candidates = [], []
    for index, section in enumerate(sections, 1):
        kind, content = section["section_type"], section["content"]
        if kind == "summary" and isinstance(content, dict) and str(content.get("text") or "").strip():
            return None
        if kind not in RESUME_FIELDS or not isinstance(content, dict) or not isinstance(content.get("items"), list):
            continue
        for position, item in enumerate(content["items"], 1):
            if not isinstance(item, dict):
                continue
            prefix = f"SECTION_{index}_ITEM_{position}"
            for field in RESUME_FIELDS[kind]:
                text = item.get(field)
                if isinstance(text, str) and text.strip():
                    source = {"label": f"{prefix}_{field.upper()}", "text": text,
                              "screened": False, "section_id": section["id"]}
                    sources.append(source)
                    if kind == "projects" and field == "description":
                        candidates.append(source)
            if kind == "experience" and isinstance(item.get("highlights"), list):
                for number, text in enumerate(item["highlights"], 1):
                    if isinstance(text, str) and text.strip():
                        source = {"label": f"{prefix}_HIGHLIGHT_{number}", "text": text,
                                  "screened": False, "section_id": section["id"]}
                        sources.append(source)
                        candidates.append(source)
    if candidates:
        generated = connection.execute("""
            SELECT DISTINCT prose FROM ai_accepted_resume_prose
            WHERE user_id = %(user_id)s AND prose = ANY(%(values)s)
        """, {"user_id": user_id, "values": list({source["text"] for source in candidates})}).fetchall()
        trusted = {row["prose"] for row in generated}
        for source in candidates:
            source["screened"] = source["text"] in trusted
    return sources


def read_summary_sources(connection, user_id, command):
    """Resolve one owner's command consistently; stale/deleted/foreign sources read nothing."""
    if connection.info.transaction_status == TransactionStatus.IDLE:
        connection.isolation_level = IsolationLevel.REPEATABLE_READ
    with connection.transaction():
        if command.target_kind == "profile":
            if str(user_id) != command.target_id:
                return None
            sources = _profile_sources(connection, user_id)
        else:
            sources = _resume_sources(connection, user_id, command.target_id)
        if sources is None or len(sources) > 1000:
            return None
        references = [{**{key: source[key] for key in ("label", "record_id", "section_id") if key in source},
                       "fingerprint": _fingerprint(source["text"])} for source in sources]
        expected = [reference.model_dump(exclude_none=True) for reference in command.source_references]
        if references != expected or _fingerprint(references) != command.source_digest:
            return None
        return SummaryGenerationInput(target_kind=command.target_kind, target_id=command.target_id,
                                      source_digest=command.source_digest, sources=sources)


def build_summary_source_reader(settings):
    """Open an ai_reader connection for each summary execution."""
    def read(user_id, command):
        with open_read_only_connection(settings) as connection:
            return read_summary_sources(connection, user_id, command)
    return read

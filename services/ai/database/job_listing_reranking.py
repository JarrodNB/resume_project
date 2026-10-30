"""Read selected public catalogue text from an owned queued reranking command.

The catalogue is shared, but only the owner's saved command selects IDs. Legacy
stored excerpts supply identities only; their copied text is never authoritative.
"""

from database.open_read_only_connection import open_read_only_connection
from database.task_commands import read_task_command
from job_postings.html_to_description_text import html_to_description_text
from schemas.job_listing_reranking import RerankListingsCommand, RerankListingsInput


def read_reranking_input(connection, notification):
    """Load bounded current excerpts, or nothing for foreign/stale/missing work."""
    if notification.task_type != "rerank_job_listings":
        return None
    task = read_task_command(connection, notification)
    if task is None:
        return None
    command = task.input
    ids = command.get("listing_ids")
    if ids is None and isinstance(command.get("listings"), list):
        ids = [item.get("id") if isinstance(item, dict) else None for item in command["listings"]]
    selected = RerankListingsCommand(keyword=command.get("keyword"), listing_ids=ids)
    rows = connection.execute(
        "SELECT id, payload FROM job_board_listings WHERE id = ANY(%s::uuid[])",
        [selected.listing_ids],
    ).fetchall()
    by_id = {row["id"]: row["payload"] for row in rows}
    if len(by_id) != len(selected.listing_ids):
        return None
    budget = min(6000, 140000 // len(selected.listing_ids))
    listings = []
    for listing_id in selected.listing_ids:
        payload = by_id[listing_id]
        title = payload.get("title") if isinstance(payload.get("title"), str) else ""
        description = payload.get("description")
        description = html_to_description_text(description if isinstance(description, str) else "")
        text = f"Job: {title}\nDescription:\n{description}"
        text = text.encode("utf-8")[:budget].decode("utf-8", errors="ignore")
        listings.append({"id": listing_id, "text": text})
    return RerankListingsInput(keyword=selected.keyword, listings=listings)


def build_reranking_reader(settings):
    """Use a repeatable read so command selection and catalogue rows agree."""
    def read(task):
        with open_read_only_connection(settings) as connection, connection.transaction():
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            return read_reranking_input(connection, task)
    return read

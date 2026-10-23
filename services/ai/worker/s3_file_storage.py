"""Read uploaded resume bytes from the configured S3 bucket.

Rails supplies Active Storage blob keys. Each response stream closes after
reading, including failed reads, so retries do not retain failed connections.
"""

from contextlib import closing

import boto3
from botocore.config import Config

from worker.settings import WorkerSettings


class S3FileStorage:
    """Downloads uploaded files from the configured bucket."""

    def __init__(self, settings: WorkerSettings) -> None:
        """Creates the boto3 S3 client (path-style URLs, which S3 emulators need)."""
        self._s3 = boto3.client(
            "s3",
            region_name=settings.aws_region,
            endpoint_url=settings.s3_endpoint_url,
            config=Config(s3={"addressing_style": "path"}),
        )
        self._bucket = settings.s3_uploads_bucket

    def download_file(self, key: str) -> bytes:
        """Returns the bytes of the object stored under `key`."""
        response = self._s3.get_object(Bucket=self._bucket, Key=key)
        with closing(response["Body"]) as body:
            return body.read()

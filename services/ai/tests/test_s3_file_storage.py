"""Check upload download cleanup without contacting S3.

Every response body must close even if reading fails, so later retries do not
retain the failed stream or replace its original error.
"""

from io import BytesIO
from types import SimpleNamespace

import pytest

from worker.s3_file_storage import S3FileStorage
from worker.task_dependencies import TaskDependencies


@pytest.mark.parametrize("read_fails", [False, True])
def test_download_closes_each_body(
    monkeypatch: pytest.MonkeyPatch, task_dependencies: TaskDependencies, read_fails: bool
) -> None:
    error = OSError("interrupted download")

    class Body(BytesIO):
        def read(self, *args: object, **kwargs: object) -> bytes:
            if read_fails:
                raise error
            return super().read(*args, **kwargs)

    bodies: list[Body] = []
    requests: list[dict[str, object]] = []

    def get_object(**kwargs: object) -> dict[str, Body]:
        requests.append(kwargs)
        body = Body(b"synthetic resume")
        bodies.append(body)
        return {"Body": body}

    client = SimpleNamespace(get_object=get_object)
    monkeypatch.setattr("worker.s3_file_storage.boto3.client", lambda *_args, **_kwargs: client)
    storage = S3FileStorage(task_dependencies.settings)

    for _ in range(2):
        if read_fails:
            with pytest.raises(OSError) as caught:
                storage.download_file("upload-key")
            assert caught.value is error
        else:
            assert storage.download_file("upload-key") == b"synthetic resume"
        assert requests[-1] == {
            "Bucket": task_dependencies.settings.s3_uploads_bucket,
            "Key": "upload-key",
        }
        assert bodies[-1].closed

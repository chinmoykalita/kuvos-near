import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


from kuvos_worker.jobs import process_one, _extract_stored, _discard_deleted_document


class EmptyDatabase:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def transaction(self):
        return self

    def execute(self, *_args):
        return self

    def fetchone(self):
        return None


with patch("kuvos_worker.jobs.psycopg.connect", return_value=EmptyDatabase()):
    assert process_one("postgresql://unused", Path("data")) is False


class SyntheticS3:
    def __init__(self):
        self.uploads = {}
        self.download_path = None

    def download_file(self, bucket, key, path):
        assert bucket == "synthetic-bucket"
        assert key == "documents/00000000-0000-4000-8000-000000000001/original.pdf"
        self.download_path = Path(path)
        self.download_path.write_bytes(b"%PDF-synthetic-document")

    def upload_file(self, path, bucket, key, ExtraArgs):
        assert bucket == "synthetic-bucket"
        self.uploads[key] = Path(path).read_bytes()


def synthetic_extract(source, run_root):
    assert source.read_bytes() == b"%PDF-synthetic-document"
    run_dir = run_root / "20260930-synthetic"
    pages = run_dir / "pages"
    pages.mkdir(parents=True)
    (pages / "page-0001.png").write_bytes(b"synthetic-page")
    (run_dir / "document.json").write_text('{"source_spans": []}')
    return {"document": {"pages": [{"image_path": "pages/page-0001.png"}]}}, run_dir


s3 = SyntheticS3()
original = "s3://synthetic-bucket/documents/00000000-0000-4000-8000-000000000001/original.pdf"
prefix = "documents/00000000-0000-4000-8000-000000000001/runs/extraction"
with patch.dict(os.environ, {"DOCUMENTS_BUCKET": "synthetic-bucket"}), patch(
    "kuvos_worker.jobs.boto3.client", return_value=s3
), patch("kuvos_worker.jobs._extract_local", side_effect=synthetic_extract):
    result, location = _extract_stored(original, "extraction", Path("unused"))
    assert location == f"s3://synthetic-bucket/{prefix}"
    assert s3.uploads[f"{prefix}/pages/page-0001.png"] == b"synthetic-page"
    assert result["document"]["pages"][0]["image_path"] == "pages/page-0001.png"
    assert not s3.download_path.exists(), "Temporary original must be removed"
    try:
        _extract_stored(original.replace("synthetic-bucket", "other-bucket"), "extraction", Path("unused"))
        raise AssertionError("Unexpected bucket accepted")
    except ValueError:
        pass

with patch.dict(os.environ, {"DOCUMENTS_BUCKET": "synthetic-bucket"}), patch(
    "kuvos_worker.jobs.boto3.client", return_value=s3
), patch("kuvos_worker.jobs._extract_local", side_effect=RuntimeError("private diagnostic")):
    try:
        _extract_stored(original, "extraction", Path("unused"))
        raise AssertionError("Extraction failure was swallowed")
    except RuntimeError:
        pass
    assert b"private diagnostic" in s3.uploads[f"{prefix}/error.json"]
    assert not s3.download_path.exists(), "Failed jobs must remove temporary originals"


class CleanupS3:
    def get_paginator(self, operation):
        assert operation == "list_objects_v2"
        return self

    def paginate(self, **request):
        assert request["Prefix"] == "documents/00000000-0000-4000-8000-000000000001/"
        yield {"Contents": [{"Key": "original"}, {"Key": "late-worker-artifact"}]}

    def delete_objects(self, **request):
        assert request["Delete"]["Objects"] == [{"Key": "original"}, {"Key": "late-worker-artifact"}]
        return {}

with patch.dict(os.environ, {"DOCUMENTS_BUCKET": "synthetic-bucket"}), patch("kuvos_worker.jobs.boto3.client", return_value=CleanupS3()):
    _discard_deleted_document(original)

class DeletedDatabase(EmptyDatabase):
    rowcount = 0

    def execute(self, statement, *_args):
        self.statement = statement
        return self

    def fetchone(self):
        if "RETURNING extraction.id" in self.statement:
            return {"id": "extraction", "document_id": "document"}
        return {"path": original}

with patch("kuvos_worker.jobs.psycopg.connect", return_value=DeletedDatabase()), patch(
    "kuvos_worker.jobs._extract_stored", return_value=({}, "s3://synthetic-bucket/unused")
), patch("kuvos_worker.jobs._discard_deleted_document") as discard:
    assert process_one("postgresql://unused", Path("unused")) is True
    discard.assert_called_once_with(original)

print("worker job check passed")

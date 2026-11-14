"""Creates the local MinIO bucket used by the self-contained demo stack (idempotent)."""
import os
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv()
s3 = boto3.client("s3", config=Config(s3={"addressing_style": "path"}))
bucket = os.environ["DOCUMENTS_BUCKET"]
# Storage may still be starting (Docker); wait up to a minute for it to answer.
for attempt in range(60):
    try:
        s3.head_bucket(Bucket=bucket)
        print(f"Bucket {bucket} exists")
        break
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") not in ("404", "NoSuchBucket"):
            raise
        s3.create_bucket(Bucket=bucket)
        print(f"Created bucket {bucket}")
        break
    except Exception:
        if attempt == 59:
            raise
        time.sleep(1)

"""Creates the local MinIO bucket used by the self-contained demo stack (idempotent)."""
import os

import boto3
from botocore.config import Config
from dotenv import load_dotenv

load_dotenv()
s3 = boto3.client("s3", config=Config(s3={"addressing_style": "path"}))
bucket = os.environ["DOCUMENTS_BUCKET"]
try:
    s3.head_bucket(Bucket=bucket)
    print(f"Bucket {bucket} exists")
except Exception:
    s3.create_bucket(Bucket=bucket)
    print(f"Created bucket {bucket}")

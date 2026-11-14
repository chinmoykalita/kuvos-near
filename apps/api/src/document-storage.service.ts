import {
  BadRequestException,
  Injectable,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { validSignature } from './workflow.utils';

@Injectable()
export class DocumentStorageService {
  readonly bucket: string;
  readonly client: S3Client;
  // Signs the browser's upload URLs. Same as `client` unless S3_PUBLIC_ENDPOINT_URL is set.
  private readonly signer: S3Client;

  constructor(config: ConfigService) {
    this.bucket = config.get('DOCUMENTS_BUCKET', '');
    // AWS_ENDPOINT_URL_S3 points the SDK at a local S3-compatible store (MinIO) for the
    // self-contained judge setup; path-style addressing is required there.
    const options = {
      region:
        config.get<string>('AWS_REGION') ||
        config.get<string>('AWS_DEFAULT_REGION'),
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE') === 'true',
    };
    this.client = new S3Client(options);
    // In Docker the API reaches MinIO at an internal host the browser cannot resolve, so
    // upload URLs are signed for the public origin that proxies to MinIO instead.
    const publicEndpoint = config.get<string>('S3_PUBLIC_ENDPOINT_URL');
    this.signer = publicEndpoint
      ? new S3Client({ ...options, endpoint: publicEndpoint })
      : this.client;
  }

  location(path: string) {
    const match = /^s3:\/\/([^/]+)\/(documents\/[0-9a-f-]{36}\/[^?#]+)$/.exec(
      path,
    );
    if (
      !this.bucket ||
      !match ||
      match[1] !== this.bucket ||
      match[2].split('/').includes('..')
    ) {
      throw new BadRequestException('Invalid document storage location.');
    }
    return { Bucket: this.bucket, Key: match[2] };
  }

  async signUpload(path: string, size: number, mimeType: string, md5: string) {
    const headers = {
      'Content-Type': mimeType,
      'Content-MD5': Buffer.from(md5, 'hex').toString('base64'),
      'If-None-Match': '*',
    };
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        ...this.location(path),
        ContentLength: size,
        ContentType: mimeType,
        ContentMD5: headers['Content-MD5'],
        IfNoneMatch: '*',
      }),
      {
        expiresIn: 300,
        signableHeaders: new Set([
          'content-type',
          'content-length',
          'content-md5',
          'if-none-match',
        ]),
      },
    );
    return { url, headers };
  }

  async verifyUpload(
    path: string,
    size: number,
    mimeType: string,
    extension: string,
  ) {
    const location = this.location(path);
    try {
      const head = await this.client.send(new HeadObjectCommand(location));
      if (head.ContentLength !== size || head.ContentType !== mimeType) {
        throw new BadRequestException(
          'The uploaded file does not match the selected document.',
        );
      }
      const response = await this.client.send(
        new GetObjectCommand({
          ...location,
          Range: 'bytes=0-15',
        }),
      );
      const bytes = await response.Body?.transformToByteArray();
      if (!bytes || !validSignature(Buffer.from(bytes), extension)) {
        throw new BadRequestException(
          'The file content does not match its extension.',
        );
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(
        'The document upload could not be verified. Please try again.',
      );
    }
  }

  async page(path: string) {
    try {
      const response = await this.client.send(
        new GetObjectCommand(this.location(path)),
      );
      if (!(response.Body instanceof Readable)) throw new NotFoundException();
      return new StreamableFile(response.Body);
    } catch {
      throw new NotFoundException('Source page is unavailable.');
    }
  }

  async removeDocument(path: string) {
    const { Bucket, Key } = this.location(path);
    const Prefix = `${Key.split('/').slice(0, 2).join('/')}/`;
    let ContinuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }),
      );
      const Objects = (page.Contents || []).flatMap((item) =>
        item.Key ? [{ Key: item.Key }] : [],
      );
      if (Objects.length) {
        const result = await this.client.send(
          new DeleteObjectsCommand({ Bucket, Delete: { Objects } }),
        );
        if (result.Errors?.length) throw new Error('Document cleanup failed.');
      }
      ContinuationToken = page.NextContinuationToken;
    } while (ContinuationToken);
  }
}

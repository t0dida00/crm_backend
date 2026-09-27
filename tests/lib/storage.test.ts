const send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'put', input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ kind: 'delete', input })),
}));
jest.mock('@vercel/blob', () => ({ put: jest.fn(), del: jest.fn() }));

import { S3Client } from '@aws-sdk/client-s3';
import { del, put } from '@vercel/blob';
import type { S3StorageConfig } from '../../src/lib/connection-input';
import { describeStorageError, imageKey, sharedStorage, uploadObject, verifyStorage } from '../../src/lib/storage';

const S3: S3StorageConfig = {
  provider: 's3',
  endpoint: 'https://acc.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'menu-photos',
  accessKeyId: 'AKIAEXAMPLE123',
  secretAccessKey: 'sup3r-s3cret-key',
  publicUrl: 'https://pub-123.r2.dev',
};
const BLOB = { provider: 'vercel_blob' as const, token: 'vercel_blob_rw_store_secret' };

/** A fetch that serves back whatever was last uploaded (the test file's content). */
const servingUploads = (status = 200) =>
  jest.fn(async () => {
    const body = (send.mock.calls.find(([c]) => c.kind === 'put')?.[0].input.Body ?? (put as jest.Mock).mock.calls[0]?.[1]) as Buffer;
    return new Response(status === 200 ? body.toString() : 'denied', { status });
  }) as unknown as typeof fetch;

beforeEach(() => {
  jest.clearAllMocks();
  send.mockResolvedValue({});
  (put as jest.Mock).mockImplementation(async (key: string) => ({ url: `https://store.public.blob.vercel-storage.com/${key}` }));
});

describe('imageKey', () => {
  it('keeps names URL-safe under dishes/', () => {
    expect(imageKey('Café latte (1).png', 42)).toBe('dishes/42-Caf-latte-1-.png');
    expect(imageKey('../../etc/passwd', 42)).toBe('dishes/42-etc-passwd');
    expect(imageKey(undefined, 42)).toBe('dishes/42-upload');
  });
});

describe('sharedStorage', () => {
  const original = process.env.BLOB_READ_WRITE_TOKEN;
  afterAll(() => {
    process.env.BLOB_READ_WRITE_TOKEN = original;
  });

  it('is the env Vercel Blob token, or null', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_x_y';
    expect(sharedStorage()).toEqual({ provider: 'vercel_blob', token: 'vercel_blob_rw_x_y' });
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(sharedStorage()).toBeNull();
  });
});

describe('uploadObject', () => {
  it('puts to the S3 bucket and returns the public URL', async () => {
    const url = await uploadObject(S3, 'dishes/1-a.png', Buffer.from('img'), 'image/png');
    expect(url).toBe('https://pub-123.r2.dev/dishes/1-a.png');
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: S3.endpoint, region: 'auto', forcePathStyle: true }),
    );
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: 'menu-photos', Key: 'dishes/1-a.png', ContentType: 'image/png' });
  });

  it("uses the business's own Vercel Blob token", async () => {
    const url = await uploadObject(BLOB, 'dishes/1-a.png', Buffer.from('img'), 'image/png');
    expect(url).toBe('https://store.public.blob.vercel-storage.com/dishes/1-a.png');
    expect(put).toHaveBeenCalledWith('dishes/1-a.png', expect.any(Buffer), {
      access: 'public',
      contentType: 'image/png',
      token: BLOB.token,
    });
  });
});

describe('verifyStorage', () => {
  it('uploads a test file, reads it back publicly without following redirects, then deletes it', async () => {
    const fetchImpl = servingUploads();
    await verifyStorage(S3, fetchImpl);

    const key = send.mock.calls[0][0].input.Key;
    expect(key).toMatch(/^connection-check\//);
    expect(fetchImpl).toHaveBeenCalledWith(`https://pub-123.r2.dev/${key}`, expect.objectContaining({ redirect: 'manual' }));
    expect(send.mock.calls[1][0]).toMatchObject({ kind: 'delete', input: { Bucket: 'menu-photos', Key: key } });
  });

  it('works the same for Vercel Blob', async () => {
    await verifyStorage(BLOB, servingUploads());
    expect(del).toHaveBeenCalledWith(expect.stringMatching(/connection-check\//), { token: BLOB.token });
  });

  it('explains a refused upload', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'InvalidAccessKeyId' }));
    await expect(verifyStorage(S3, servingUploads())).rejects.toThrow(
      'Storage refused a test upload: the access key ID or secret is wrong',
    );
  });

  it("fails, and still cleans up, when the file isn't publicly readable", async () => {
    await expect(verifyStorage(S3, servingUploads(403))).rejects.toThrow(/isn't publicly readable .*answered 403/);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("doesn't fail because the keys can't delete", async () => {
    send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(verifyStorage(S3, servingUploads())).resolves.toBeUndefined();
  });
});

describe('describeStorageError', () => {
  it('names unreachable endpoints and HTTP answers', () => {
    expect(describeStorageError(Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }))).toBe(
      "couldn't reach the storage endpoint",
    );
    expect(describeStorageError({ name: 'Weird', $metadata: { httpStatusCode: 400 } })).toBe(
      'the storage service answered 400 (Weird)',
    );
  });
});

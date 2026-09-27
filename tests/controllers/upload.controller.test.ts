jest.mock('../../src/lib/platform-context', () => ({ resolvePlatformMembership: jest.fn() }));
jest.mock('../../src/lib/platform-connections', () => ({ getConnection: jest.fn(), sharedInfraAllowed: jest.fn() }));
jest.mock('../../src/lib/storage', () => ({
  ...jest.requireActual('../../src/lib/storage'),
  sharedStorage: jest.fn(),
  uploadObject: jest.fn(),
}));

import { Response } from 'express';
import { resolvePlatformMembership } from '../../src/lib/platform-context';
import { getConnection, sharedInfraAllowed } from '../../src/lib/platform-connections';
import { sharedStorage, uploadObject } from '../../src/lib/storage';
import { uploadImage } from '../../src/controllers/upload.controller';
import { AuthedRequest } from '../../src/middleware/auth.middleware';

const OWN = { provider: 's3', bucket: 'b', publicUrl: 'https://cdn.example.com' };
const SHARED = { provider: 'vercel_blob', token: 'vercel_blob_rw_x_y' };

const call = async ({ type = 'image/png', body = Buffer.from('png') as unknown, name = 'Latte.png' } = {}) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const headers: Record<string, string> = { 'content-type': type, 'x-filename': name };
  const req = { userId: 'u1', body, headers, header: (h: string) => headers[h.toLowerCase()] } as unknown as AuthedRequest;
  await uploadImage(req, { status } as unknown as Response);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
};

describe('uploadImage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (resolvePlatformMembership as jest.Mock).mockResolvedValue({ platformId: 'p1', role: 'STAFF' });
    (getConnection as jest.Mock).mockResolvedValue({ storage: null });
    (sharedInfraAllowed as jest.Mock).mockReturnValue(true);
    (sharedStorage as jest.Mock).mockReturnValue(SHARED);
    (uploadObject as jest.Mock).mockResolvedValue('https://cdn.example.com/dishes/1-Latte.png');
  });

  it("stores the image in the business's own storage", async () => {
    (getConnection as jest.Mock).mockResolvedValue({ storage: OWN });
    const res = await call();
    expect(res).toEqual({ status: 200, body: { url: 'https://cdn.example.com/dishes/1-Latte.png' } });
    expect(uploadObject).toHaveBeenCalledWith(OWN, expect.stringMatching(/^dishes\/\d+-Latte\.png$/), expect.any(Buffer), 'image/png');
  });

  it('falls back to the shared store', async () => {
    await call();
    expect((uploadObject as jest.Mock).mock.calls[0][0]).toBe(SHARED);
  });

  it('refuses other file types and empty bodies', async () => {
    expect((await call({ type: 'application/pdf' })).status).toBe(400);
    expect((await call({ body: {} })).status).toBe(400);
    expect((await call({ body: Buffer.alloc(0) })).status).toBe(400);
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it('asks the owner to connect storage when the shared service is off', async () => {
    (sharedInfraAllowed as jest.Mock).mockReturnValue(false);
    expect((await call()).status).toBe(409);
  });

  it("reports a server without a shared token", async () => {
    (sharedStorage as jest.Mock).mockReturnValue(null);
    expect((await call()).status).toBe(503);
  });

  it('explains a failed upload', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (uploadObject as jest.Mock).mockRejectedValue(Object.assign(new Error('x'), { name: 'NoSuchBucket' }));
    expect(await call()).toEqual({ status: 502, body: { error: "Couldn't save the image: that bucket doesn't exist." } });
  });
});

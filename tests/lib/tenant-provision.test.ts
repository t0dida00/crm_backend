import { checkTenantDatabase, describePusherError, provisionTenantDatabase, verifyPusher } from '../../src/lib/tenant-provision';

const platform = {
  id: 'p1',
  name: 'Casa',
  platform_types: { id: 't1', code: 'CAFE', name: 'Cafe' },
  profile: { phone: '+34 600', email: 'hi@casa.com', address: 'Mar 1', logo_url: null },
};

/** A pg Client stand-in: answers queries by matching SQL text. */
function fakeClient(answers: {
  tables: number;
  owner?: string;
  failOn?: RegExp;
  connectError?: Error;
  /** The database's server_encoding; UTF8 unless a test says otherwise. */
  encoding?: string;
}) {
  const queries: string[] = [];
  const client = {
    connect: jest.fn(async () => {
      if (answers.connectError) throw answers.connectError;
    }),
    end: jest.fn(async () => {}),
    query: jest.fn(async (sql: string, _params?: unknown[]) => {
      queries.push(sql);
      if (answers.failOn?.test(sql)) throw new Error('boom');
      if (sql.includes('information_schema.tables')) {
        return { rows: [{ count: String(answers.tables), encoding: answers.encoding ?? 'UTF8' }] };
      }
      if (sql.includes('FROM "tenant_meta"')) {
        if (answers.owner === undefined) throw new Error('relation "tenant_meta" does not exist');
        return { rows: [{ platform_id: answers.owner }] };
      }
      return { rows: [] };
    }),
  };
  return { client, queries, make: () => client as never };
}

describe('provisionTenantDatabase', () => {
  it('sets up an empty database in one transaction and marks its owner', async () => {
    const { client, queries, make } = fakeClient({ tables: 0 });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).resolves.toEqual({ created: true });
    expect(queries[2]).toBe('BEGIN');
    expect(queries[3]).toContain('CREATE TABLE "menu_items"');
    expect(queries.some((q) => q.includes('INSERT INTO "tenant_meta"'))).toBe(true);
    // The business profile is copied into the business's own database.
    const insert = client.query.mock.calls.find(([q]) => String(q).includes('INSERT INTO "platforms"'));
    expect(insert?.[1]).toEqual(['p1', 't1', 'Casa', '+34 600', 'hi@casa.com', 'Mar 1', null]);
    expect(queries.at(-1)).toBe('COMMIT');
    expect(client.end).toHaveBeenCalled();
  });

  it('accepts a database this business already set up', async () => {
    const { queries, make } = fakeClient({ tables: 16, owner: 'p1' });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).resolves.toEqual({ created: false });
    expect(queries).not.toContain('BEGIN');
    expect(queries.some((q) => q.startsWith('UPDATE "platforms"'))).toBe(true);
  });

  it('refuses a database that is not UTF-8, before writing anything', async () => {
    const { queries, make } = fakeClient({ tables: 0, encoding: 'LATIN1' });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).rejects.toThrow(
      /uses the LATIN1 encoding\. Tably needs UTF-8/,
    );
    expect(queries).not.toContain('BEGIN');
  });

  it("refuses another business's database", async () => {
    const { make } = fakeClient({ tables: 16, owner: 'p2' });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).rejects.toThrow(/another business/);
  });

  it('refuses a database that already has unrelated tables', async () => {
    const { make } = fakeClient({ tables: 3 });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).rejects.toThrow(/already has tables/);
  });

  it('rolls back when setup fails', async () => {
    const { queries, make } = fakeClient({ tables: 0, failOn: /INSERT INTO "platforms"/ });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).rejects.toThrow(/Couldn't set up/);
    expect(queries.at(-1)).toBe('ROLLBACK');
  });

  it('explains a connection failure', async () => {
    const { client, make } = fakeClient({ tables: 0, connectError: new Error('password authentication failed') });
    await expect(provisionTenantDatabase('postgresql://x/db', platform, make)).rejects.toThrow(
      "Couldn't connect to the database: password authentication failed",
    );
    expect(client.end).toHaveBeenCalled();
  });
});

describe('checkTenantDatabase', () => {
  it('accepts an empty database without writing to it', async () => {
    const { client, queries, make } = fakeClient({ tables: 0 });
    await expect(checkTenantDatabase('postgresql://x/db', null, make)).resolves.toBeUndefined();
    expect(queries.some((q) => /BEGIN|CREATE|INSERT|UPDATE/.test(q))).toBe(false);
    expect(client.end).toHaveBeenCalled();
  });

  it("accepts this business's own database, but not before the business exists", async () => {
    await expect(checkTenantDatabase('postgresql://x/db', 'p1', fakeClient({ tables: 16, owner: 'p1' }).make)).resolves.toBeUndefined();
    await expect(checkTenantDatabase('postgresql://x/db', null, fakeClient({ tables: 16, owner: 'p1' }).make)).rejects.toThrow(
      /another business/,
    );
  });

  it('refuses a database with unrelated tables', async () => {
    await expect(checkTenantDatabase('postgresql://x/db', null, fakeClient({ tables: 3 }).make)).rejects.toThrow(/already has tables/);
  });
});

describe('verifyPusher', () => {
  const creds = { appId: '1', key: 'abcdefgh12', secret: 'abcdefgh34', cluster: 'eu' };
  const networkError = Object.assign(new Error('Request failed with an error'), { error: new Error('getaddrinfo ENOTFOUND api-eu.pusher.com') });
  const answered = (status: number) => Object.assign(new Error(`Unexpected status code ${status}`), { status });
  const withGet = (get: jest.Mock) => () => ({ get }) as never;

  it('passes when Pusher answers', async () => {
    const get = jest.fn().mockResolvedValue({ status: 200 });
    await expect(verifyPusher(creds, withGet(get))).resolves.toBeUndefined();
  });

  it('retries a network failure once', async () => {
    const get = jest.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce({ status: 200 });
    await expect(verifyPusher(creds, withGet(get))).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('says it could not reach Pusher, not that the credentials are wrong', async () => {
    const get = jest.fn().mockRejectedValue(networkError);
    await expect(verifyPusher(creds, withGet(get))).rejects.toThrow(
      "Couldn't reach Pusher (getaddrinfo ENOTFOUND api-eu.pusher.com). Check your internet connection and the cluster, then try again.",
    );
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('explains a timeout', () => {
    const abort = Object.assign(new Error('Request failed with an error'), { error: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
    expect(describePusherError(abort)).toMatch(/it took too long to answer/);
  });

  it('does not retry when Pusher rejects the credentials', async () => {
    const get = jest.fn().mockRejectedValue(answered(401));
    await expect(verifyPusher(creds, withGet(get))).rejects.toThrow('Pusher rejected these credentials. Check the key and secret.');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('points at the app ID and cluster on 404', () => {
    expect(describePusherError(answered(404))).toMatch(/app ID and cluster/);
  });
});

import {
  checkDatabaseUrl,
  checkPusherCredentials,
  ConnectionInputError,
  isPrivateAddress,
} from '../../src/lib/connection-input';

const publicDns = async () => [{ address: '203.0.113.10', family: 4 }];
const privateDns = async () => [{ address: '10.0.0.5', family: 4 }];

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])(
    'flags %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(['203.0.113.10', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe('checkDatabaseUrl', () => {
  it('returns the URL and a password-free label', async () => {
    const res = await checkDatabaseUrl('postgresql://u:secret@db.example.com:5432/shop?sslmode=require', {
      production: true,
      resolve: publicDns as never,
    });
    expect(res.label).toBe('db.example.com/shop');
    expect(res.label).not.toContain('secret');
  });

  it.each([
    [undefined, 'Database URL is required'],
    ['nonsense', "Database URL isn't a valid URL"],
    ['mysql://u:p@h/db', 'Database URL must start with postgresql://'],
    ['postgresql://u:p@db.example.com', 'Database URL has no database name'],
  ])('rejects %p', async (raw, message) => {
    await expect(checkDatabaseUrl(raw, { production: false })).rejects.toThrow(message);
  });

  it('requires SSL in production', async () => {
    await expect(
      checkDatabaseUrl('postgresql://u:p@db.example.com/shop', { production: true, resolve: publicDns as never }),
    ).rejects.toThrow(/SSL/);
  });

  it('rejects hosts that resolve to private addresses in production', async () => {
    await expect(
      checkDatabaseUrl('postgresql://u:p@internal.example.com/shop?sslmode=require', {
        production: true,
        resolve: privateDns as never,
      }),
    ).rejects.toThrow(ConnectionInputError);
    await expect(
      checkDatabaseUrl('postgresql://u:p@127.0.0.1/shop?sslmode=require', { production: true }),
    ).rejects.toThrow(/publicly reachable/);
  });

  it('allows localhost outside production', async () => {
    const res = await checkDatabaseUrl('postgresql://u:p@localhost:5434/shop', { production: false });
    expect(res.label).toBe('localhost/shop');
  });
});

describe('checkPusherCredentials', () => {
  const valid = { appId: '123456', key: 'abcdef1234567890', secret: 'fedcba0987654321', cluster: 'eu' };

  it('trims and accepts valid credentials', () => {
    expect(checkPusherCredentials({ ...valid, key: ` ${valid.key} ` })).toEqual(valid);
  });

  it.each([
    [{ ...valid, appId: 'abc' }, /app ID/],
    [{ ...valid, key: 'short' }, /key/],
    [{ ...valid, secret: '' }, /secret/],
    [{ ...valid, cluster: 'evil.com/x' }, /cluster/],
  ])('rejects bad input %#', (body, message) => {
    expect(() => checkPusherCredentials(body)).toThrow(message);
  });
});

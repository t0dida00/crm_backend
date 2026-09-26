const trigger = jest.fn();
jest.mock('pusher', () => jest.fn().mockImplementation((opts) => ({ opts, trigger })));
jest.mock('../../src/lib/platform-connections', () => ({ getConnection: jest.fn() }));

import Pusher from 'pusher';
import { getConnection } from '../../src/lib/platform-connections';
import { emitToPlatform } from '../../src/realtime/socket';

const OWN = { appId: '42', key: 'ownkey12345', secret: 'ownsecret123', cluster: 'eu' };

describe('emitToPlatform', () => {
  const env = { ...process.env };
  beforeEach(() => {
    trigger.mockReset();
    Object.assign(process.env, { PUSHER_APP_ID: '1', PUSHER_KEY: 'sharedkey1', PUSHER_SECRET: 'sharedsecret', PUSHER_CLUSTER: 'ap1' });
  });
  afterAll(() => {
    process.env = env;
  });

  it("uses the business's own Pusher app when it has one", async () => {
    (getConnection as jest.Mock).mockResolvedValue({ databaseUrl: null, pusher: OWN });
    await emitToPlatform('p1', 'order:created', { id: 'o1' });
    const client = (Pusher as unknown as jest.Mock).mock.results.at(-1)!.value;
    expect(client.opts).toMatchObject({ appId: '42', key: 'ownkey12345', cluster: 'eu' });
    expect(trigger).toHaveBeenCalledWith('platform-p1', 'order:created', { id: 'o1' });
  });

  it('falls back to the shared app from env', async () => {
    (getConnection as jest.Mock).mockResolvedValue({ databaseUrl: null, pusher: null });
    await emitToPlatform('p2', 'order:updated', {});
    const lastOpts = (Pusher as unknown as jest.Mock).mock.calls.at(-1)![0];
    expect(lastOpts).toMatchObject({ appId: '1', key: 'sharedkey1', cluster: 'ap1' });
    expect(trigger).toHaveBeenCalledWith('platform-p2', 'order:updated', {});
  });

  it('never throws, even when the lookup fails', async () => {
    (getConnection as jest.Mock).mockRejectedValue(new Error('CREDENTIALS_KEY missing'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(emitToPlatform('p3', 'x', {})).resolves.toBeUndefined();
    expect(trigger).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

import { findTooLong, limitTextLength } from '../../src/middleware/limit-text';

const long = 'x'.repeat(251);

describe('limitTextLength', () => {
  it('finds a too-long input field at any depth', () => {
    expect(findTooLong({ name: 'x'.repeat(250) })).toBeNull();
    expect(findTooLong({ name: long })).toBe('name');
    expect(findTooLong({ pusher: { secret: long } })).toBe('secret');
    expect(findTooLong({ lines: [{ itemId: 'a' }, { itemId: long }] })).toBe('itemId');
  });

  it('leaves text areas and URLs alone', () => {
    expect(findTooLong({ description: long, note: long, databaseUrl: long, logoUrl: long })).toBeNull();
    expect(findTooLong({ lines: [{ itemId: 'a', note: long }] })).toBeNull();
  });

  it('answers 400 naming the field, or passes the request on', () => {
    const json = jest.fn();
    const res = { status: jest.fn().mockReturnValue({ json }) };
    const next = jest.fn();
    limitTextLength({ body: { fullName: long } } as never, res as never, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'fullName must be 250 characters or fewer' });
    expect(next).not.toHaveBeenCalled();

    limitTextLength({ body: { fullName: 'Ana Ruiz' } } as never, res as never, next);
    expect(next).toHaveBeenCalled();
  });
});

import { isCount, isFullName, isNonNegative, isValidEmail, isValidPhone } from '../../src/lib/validation';

describe('validation rules', () => {
  it('phone: digits with an optional leading +', () => {
    for (const v of ['+34600000000', '+34 600 000 000', '600000000']) expect(isValidPhone(v)).toBe(true);
    for (const v of ['', 'sadsa', '600-000-000', '34+600000', '12345', 42]) expect(isValidPhone(v)).toBe(false);
  });
  it('email format', () => {
    expect(isValidEmail('ana@casa.com')).toBe(true);
    for (const v of ['ana', 'ana@casa', 'a b@c.com', undefined]) expect(isValidEmail(v)).toBe(false);
  });
  it('full name is at least two words', () => {
    expect(isFullName('Ana Ruiz')).toBe(true);
    for (const v of ['Ana', '  ', null]) expect(isFullName(v)).toBe(false);
  });
  it('counts are whole numbers from 1', () => {
    expect(isCount(1)).toBe(true);
    for (const v of [0, -4, 2.5, '3', NaN]) expect(isCount(v)).toBe(false);
  });
  it('prices and percentages are never negative', () => {
    for (const v of [0, 12.5]) expect(isNonNegative(v)).toBe(true);
    for (const v of [-1, NaN, Infinity, '5']) expect(isNonNegative(v)).toBe(false);
  });
});

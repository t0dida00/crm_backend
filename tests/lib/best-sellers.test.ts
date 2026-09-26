import { bestSellerIds } from '../../src/lib/best-sellers';

const dish = (id: string, sold_count: number, name = id) => ({ id, name, sold_count });

describe('bestSellerIds', () => {
  it('picks the top 5 by sold_count', () => {
    const dishes = [dish('a', 1), dish('b', 9), dish('c', 4), dish('d', 7), dish('e', 2), dish('f', 8)];
    expect([...bestSellerIds(dishes)]).toEqual(['b', 'f', 'd', 'c', 'e']);
  });

  it('never tags dishes that have not sold', () => {
    expect([...bestSellerIds([dish('a', 0), dish('b', 3)])]).toEqual(['b']);
  });

  it('breaks ties by name', () => {
    const dishes = [dish('1', 5, 'Tea'), dish('2', 5, 'Coffee'), dish('3', 5, 'Juice')];
    expect([...bestSellerIds(dishes, 2)]).toEqual(['2', '3']);
  });

  it('does not mutate the input', () => {
    const dishes = [dish('a', 1), dish('b', 2)];
    bestSellerIds(dishes);
    expect(dishes.map((d) => d.id)).toEqual(['a', 'b']);
  });
});

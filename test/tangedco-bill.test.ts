import { calculateTangedcoBill } from '../lambda/analyze';

describe('calculateTangedcoBill', () => {
  test.each([
    [200, 75],
    [201, 79.7],
    [400, 1015],
    [485, 1550.5],
    [500, 1645],
    [501, 2123.4],
    [600, 2955],
    [800, 4845],
    [801, 4856.25],
    [1000, 7095],
  ])('calculates the telescopic bill for %i units', (units, expectedBill) => {
    expect(calculateTangedcoBill(units)).toBe(expectedBill);
  });

  test('rejects negative or non-finite totals', () => {
    expect(() => calculateTangedcoBill(-1)).toThrow('totalUnits must be a non-negative number');
    expect(() => calculateTangedcoBill(Number.POSITIVE_INFINITY)).toThrow(
      'totalUnits must be a non-negative number',
    );
  });
});

/// <reference types="jest" />
import { Queue } from './queue';

describe('Queue', () => {
  // const sourceNextSpy = jest.spyOn(pMapIterable.prototype as any, 'sourceNext');
  // const startAnotherRunnerSpy = jest.spyOn(pMapIterable.prototype as any, 'startAnotherRunner');

  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dequeue empty returns undefined', () => {
    const q = new Queue<string>();
    expect(q.dequeue()).toBeUndefined();
  });

  it('enqueue undefined throws', () => {
    const q = new Queue<string | undefined>();
    let thrown = false;
    try {
      q.enqueue(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      // Note: The pattern below worked locally but in CI it reported the throw as uncovered
      // expect(() => q.enqueue(undefined)).toThrowError('cannot enqueue `undefined`');
      thrown = true;
      expect(e.message).toBe('cannot enqueue `undefined`');
    }
    expect(thrown).toBe(true);
    expect(q.length).toBe(0);
  });

  it('enqueue, dequeue, dequeue returns undefined', () => {
    const q = new Queue<string>();
    q.enqueue('one');
    expect(q.length).toBe(1);
    expect(q.dequeue()).toBe('one');
    expect(q.length).toBe(0);
    expect(q.dequeue()).toBeUndefined();
  });

  it('ordering of several items is correct', () => {
    const input = [1, 2, 3, 4, 5, 6];
    const q = new Queue<number>();
    for (const item of input) {
      q.enqueue(item);
    }

    const inputCount = input.length;
    let loopCount = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const item = q.dequeue();

      if (item === undefined) break;
      expect(q.length).toBe(inputCount - loopCount - 1);

      loopCount++;
      expect(item).toBe(input.shift());
    }
    expect(loopCount).toBe(inputCount);
    expect(q.length).toBe(0);
  });

  it('interleaved enqueue/dequeue work correctly', () => {
    const q = new Queue<number>();

    const totalValues = 1000;
    let value = 0;
    let expectedRemovedValue = 0;
    for (let i = 0; i < totalValues; i++) {
      // 2 forward, 1 back
      expect(q.length).toBe(i);
      q.enqueue(value++); // 0 first loop
      expect(q.length).toBe(i + 1);
      q.enqueue(value++); // 1 first loop

      expect(q.length).toBe(i + 2);
      expect(q.dequeue()).toBe(expectedRemovedValue++); // 0 first loop
      expect(q.length).toBe(i + 1);
    }

    expect(q.length).toBe(totalValues);

    // Remove all the rest of the items
    for (let i = 0; i < totalValues; i++) {
      expect(q.dequeue()).toBe(expectedRemovedValue++); // totalValues first loop
    }

    expect(q.length).toBe(0);
    expect(q.dequeue()).toBeUndefined();
  });
});

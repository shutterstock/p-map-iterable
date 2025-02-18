/* eslint-disable @typescript-eslint/no-explicit-any */
/// <reference types="jest" />
import { IterableMapper } from './iterable-mapper';
import { promisify } from 'util';
const sleep = promisify(setTimeout);

async function mapper({ value, ms }: { value: number; ms: number }): Promise<number> {
  await sleep(ms);
  return value;
}

class SleepIterator implements AsyncIterable<number> {
  private _max: number;
  private _current = 1;

  constructor(max: number) {
    this._max = max;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<number> {
    for (let i = 0; i < this._max; i++) {
      await sleep(1 * (i % 10));

      if (this._current <= this._max) {
        yield this._current;
      }

      this._current++;
    }
  }
}

class ThrowingIterator implements AsyncIterable<number> {
  private _throwOnIndex: number;
  private _delayMS: number;
  private _max: number;
  constructor(max: number, throwOnIndex: number, delayMS: number) {
    this._max = max;
    this._throwOnIndex = throwOnIndex;
    this._delayMS = delayMS;
  }
  public [Symbol.asyncIterator](): AsyncIterator<number> {
    let index = 0;
    const max = this._max;
    const delayMS = this._delayMS;
    const throwOnIndex = this._throwOnIndex;
    return {
      async next(): Promise<IteratorResult<number>> {
        await sleep(delayMS);
        if (index === throwOnIndex) {
          throw new Error(`throwing on index ${index}`);
        }
        const item = { value: index, done: index === max };
        index++;
        return item;
      },
    };
  }
}

describe('IterableMapper', () => {
  const sourceNextSpy = jest.spyOn(IterableMapper.prototype as any, 'sourceNext');
  const startAnotherRunnerSpy = jest.spyOn(IterableMapper.prototype as any, 'startAnotherRunner');

  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    const validInput = [1, 2, 3];
    const validMapper = async (x: number) => {
      await sleep(1);
      return x * 2;
    };

    test('should throw TypeError if mapper is not a function', () => {
      expect(() => {
        new IterableMapper(validInput, null as any);
      }).toThrow(TypeError);
    });

    test('should throw TypeError if concurrency is not a valid integer or Infinity', () => {
      expect(() => {
        new IterableMapper(validInput, validMapper, { concurrency: 0 });
      }).toThrow(TypeError);

      expect(() => {
        new IterableMapper(validInput, validMapper, { concurrency: -1 });
      }).toThrow(TypeError);

      expect(() => {
        new IterableMapper(validInput, validMapper, { concurrency: 1.5 });
      }).toThrow(TypeError);
    });

    test('should throw TypeError if maxUnread is not a valid integer or Infinity', () => {
      expect(() => {
        new IterableMapper(validInput, validMapper, { maxUnread: 0 });
      }).toThrow(TypeError);

      expect(() => {
        new IterableMapper(validInput, validMapper, { maxUnread: -1 });
      }).toThrow(TypeError);

      expect(() => {
        new IterableMapper(validInput, validMapper, { maxUnread: 1.5 });
      }).toThrow(TypeError);
    });

    test('should throw TypeError if maxUnread is less than concurrency', () => {
      expect(() => {
        new IterableMapper(validInput, validMapper, { concurrency: 5, maxUnread: 4 });
      }).toThrow(TypeError);
    });
  });

  describe('simple tests', () => {
    it('simple mapper works - sync mapper', async () => {
      const max = 100;
      const iterator = new SleepIterator(max);
      let total = 0;
      let callCount = 0;
      const prefetcher = new IterableMapper(iterator, (value: number): number => {
        callCount++;
        total += value;
        return total;
      });

      let lastTotal = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastTotal) {
          lastTotal = item;
        }
      }

      expect(callCount).toBe(max);
      expect(loopCount).toBe(max);
      expect(total).toBe((max * (max + 1)) / 2);
      expect(lastTotal).toBe((max * (max + 1)) / 2);
    });

    it('simple mapper works - async mapper', async () => {
      const max = 100;
      const iterator = new SleepIterator(max);
      let total = 0;
      let callCount = 0;
      const prefetcher = new IterableMapper(iterator, async (value: number): Promise<number> => {
        callCount++;
        total += value;
        await sleep(10 * (callCount % 6));
        return total;
      });

      let lastTotal = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastTotal) {
          lastTotal = item;
        }
      }

      expect(callCount).toBe(max);
      expect(loopCount).toBe(max);
      expect(total).toBe((max * (max + 1)) / 2);
      expect(lastTotal).toBe((max * (max + 1)) / 2);
    });

    it('async mapper works - parallel next() calls', async () => {
      const max = 100;
      const inputIterator = new SleepIterator(max);
      let total = 0;
      let callCount = 0;
      const prefetcher = new IterableMapper(
        inputIterator,
        async (value: number): Promise<number> => {
          callCount++;
          total += value;
          await sleep(10 * (callCount % 6));
          return total;
        },
      );

      let lastTotal = 0;
      let loopCount = 0;
      const nextPromises: Promise<IteratorResult<number>>[] = [];
      const iterator = prefetcher[Symbol.asyncIterator]();
      for (let i = 0; i < max + 1; i++) {
        nextPromises.push(iterator.next());
      }

      // Wait for all the readers to resolve
      await Promise.all(nextPromises);
      for await (const item of nextPromises) {
        if (item.done === true) {
          break;
        }
        loopCount++;
        if (item.value > lastTotal) {
          lastTotal = item.value;
        }
      }

      expect(callCount).toBe(max);
      expect(loopCount).toBe(max);
      expect(total).toBe((max * (max + 1)) / 2);
      expect(lastTotal).toBe((max * (max + 1)) / 2);
    });

    it('right number run in parallel - simple', async () => {
      const startTime = Date.now();
      const max = 8;
      const delayBetweenMs = 200;
      const input = [
        { value: 1, ms: delayBetweenMs },
        { value: 2, ms: delayBetweenMs },
        { value: 3, ms: delayBetweenMs },
        { value: 4, ms: delayBetweenMs },
        { value: 5, ms: delayBetweenMs },
        { value: 6, ms: delayBetweenMs },
        { value: 7, ms: delayBetweenMs },
        { value: 8, ms: delayBetweenMs },
      ];
      const prefetcher = new IterableMapper(input, mapper, { concurrency: 2, maxUnread: 4 });

      let lastSeen = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastSeen) {
          lastSeen = item;
        }
      }

      expect(loopCount).toBe(max);
      expect(lastSeen).toBe(max);
      // Should require at least 2 batches
      expect(Date.now() - startTime).toBeLessThan(5 * delayBetweenMs);
      expect(Date.now() - startTime).toBeGreaterThan(4 * delayBetweenMs);
      // The runners should never stop because the items are consumed immediately
      expect(startAnotherRunnerSpy).toHaveBeenCalledTimes(0);
    });

    // T0    - Mapping - Start 1, 2, waiting 200 ms
    //         Q: []
    //         Runners - 2 running
    // T200  - Mapping - Finished 1, 2
    //         Q: [1, 2]
    //         Iterate - Start 1, waiting 300 ms
    //         Q: [2]
    //         Mapping - Start 3, 4, waiting 200 ms
    // T400  - Mapping - Finished 3, 4
    //         Q: [2, 3, 4]
    //         Runners - 1 exits, 1 running
    //         Mapping - Start 5, waiting 200 ms
    // T500  - Iterate - Start 2, waiting 300 ms
    //         Q: [3, 4]
    //         Runners - ***1 starts, 2 running after
    //         Mapping - Start 6, waiting 200 ms
    // T600  - Mapping - Finished 5
    //         Q: [3, 4, 5]
    //         Runners - 1 exits, 1 running after
    // T700  - Mapping - Finished 6
    //         Q: [3, 4, 5, 6]
    //         Runners - 1 exits, 0 running after
    // T800  - Iterate - Finished 2
    //         Iterate - Start 3, waiting 300 ms
    //         Q: [4, 5, 6]
    //         Runners - ***1 starts, 1 running after
    //         Mapping - Start 7, waiting 200 ms
    // T1000 - Mapping - Finished 7
    //         Q: [4, 5, 6, 7]
    //         Runners - 1 exits, 0 running after
    // T1100 - Iterate - Finished 3
    //         Iterate - Start 4, waiting 300 ms
    //         Q: [5, 6, 7]
    //         Runners - ***1 starts, 1 running after
    // T1101 - Mapping - Iteration Done
    //         Runners - 1 exits, 0 running after
    //         Q: [5, 6, 7]
    // T1400 - Iterate - Finished 4
    //         Iterate - Start 5, waiting 300 ms
    //         Q: [6, 7]
    // T1700 - Iterate - Finished 5
    //         Iterate - Start 6, waiting 300 ms
    //         Q: [7]
    // T2000 - Iterate - Finished 6
    //         Iterate - Start 7, waiting 300 ms
    //         Q: []
    // T2300 - Iterate - Finished 7
    //         Q: []
    it('right number run in parallel - delay in reading', async () => {
      const startTime = Date.now();
      const max = 7;
      const mapDelayMs = 200;
      const readDelayMs = 300;
      const input = [
        { value: 1, ms: mapDelayMs },
        { value: 2, ms: mapDelayMs },
        { value: 3, ms: mapDelayMs },
        { value: 4, ms: mapDelayMs },
        { value: 5, ms: mapDelayMs },
        { value: 6, ms: mapDelayMs },
        { value: 7, ms: mapDelayMs },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any

      const prefetcher = new IterableMapper(input, mapper, { concurrency: 2, maxUnread: 4 });

      let lastSeen = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastSeen) {
          lastSeen = item;
        }
        await sleep(readDelayMs);
      }

      expect(loopCount).toBe(max);
      expect(lastSeen).toBe(max);
      // 1st we wait 1 mapDelayMs for the 1st item to be ready
      // Then, as we iterate the mapped items, we wait readDelayMs for "processing"
      // This means that all the subsequent mapper calls never delay us because the
      // prefetch queue is always full.
      // Because of the prime numbers (2, 3, and 7) we know that we didn't accidentally
      // cause delays of a multiple of the wrong number.
      expect(Date.now() - startTime).toBeGreaterThan(mapDelayMs + max * readDelayMs);

      expect(sourceNextSpy).toHaveBeenCalledTimes(max + 1);
      expect(startAnotherRunnerSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('empty iterables', () => {
    it('empty sync iterable works - sync mapper', async () => {
      let total = 0;
      let callCount = 0;
      const prefetcher = new IterableMapper([], (value: number) => {
        callCount++;
        total += value;
        return total;
      });

      let lastTotal = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastTotal) {
          lastTotal = item;
        }
      }

      expect(callCount).toBe(0);
      expect(loopCount).toBe(0);
      expect(total).toBe(0);
      expect(lastTotal).toBe(0);
    });

    it('empty sync iterable works - async mapper', async () => {
      let total = 0;
      let callCount = 0;
      const prefetcher = new IterableMapper([], async (value: number): Promise<number> => {
        await sleep(10);
        callCount++;
        total += value;
        return total;
      });

      let lastTotal = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastTotal) {
          lastTotal = item;
        }
      }

      expect(callCount).toBe(0);
      expect(loopCount).toBe(0);
      expect(total).toBe(0);
      expect(lastTotal).toBe(0);
    });

    it('empty async iterable works - sync mapper', async () => {
      let total = 0;
      let callCount = 0;
      const prefetcher = new IterableMapper(
        ((): AsyncIterable<number> => {
          return {
            [Symbol.asyncIterator](): AsyncIterator<number> {
              return {
                async next(): Promise<IteratorResult<number>> {
                  await sleep(100);
                  return { value: undefined, done: true };
                },
              };
            },
          };
        })(),
        (value: number) => {
          callCount++;
          total += value;
          return total;
        },
      );

      let lastTotal = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastTotal) {
          lastTotal = item;
        }
      }

      expect(callCount).toBe(0);
      expect(loopCount).toBe(0);
      expect(total).toBe(0);
      expect(lastTotal).toBe(0);
    });

    it('empty async iterable works - async mapper', async () => {
      let total = 0;
      let callCount = 0;
      const prefetcher = new IterableMapper(
        ((): AsyncIterable<number> => {
          return {
            [Symbol.asyncIterator](): AsyncIterator<number> {
              return {
                async next(): Promise<IteratorResult<number>> {
                  await sleep(100);
                  return { value: undefined, done: true };
                },
              };
            },
          };
        })(),
        async (value: number): Promise<number> => {
          await sleep(10);
          callCount++;
          total += value;
          return total;
        },
      );

      let lastTotal = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastTotal) {
          lastTotal = item;
        }
      }

      expect(callCount).toBe(0);
      expect(loopCount).toBe(0);
      expect(total).toBe(0);
      expect(lastTotal).toBe(0);
    });
  });

  describe('order preservation tests', () => {
    it('preserves exact sequential order under high load with concurrency 1, maxUnread 8', async () => {
      const size = 1000;
      const input = Array.from({ length: size }, (_, i) => ({
        value: i + 1,
        ms: Math.floor(Math.random() * 20), // Random delay 0-19ms
      }));

      const mappedOrder: number[] = [];
      const iteratedOrder: number[] = [];

      const prefetcher = new IterableMapper(
        input,
        async ({ value, ms }): Promise<number> => {
          await sleep(ms);
          mappedOrder.push(value);
          return value;
        },
        { concurrency: 1, maxUnread: 8 },
      );

      for await (const value of prefetcher) {
        iteratedOrder.push(value);
        // Add some random delay in consuming to create backpressure
        await sleep(Math.floor(Math.random() * 20));
      }

      // Verify exact sequential order preservation
      expect(iteratedOrder).toHaveLength(size);
      expect(mappedOrder).toHaveLength(size);

      // Verify that both mapped and iterated orders match the input sequence
      const expectedOrder = Array.from({ length: size }, (_, i) => i + 1);
      expect(mappedOrder).toEqual(expectedOrder);
      expect(iteratedOrder).toEqual(expectedOrder);
    }, 30000);
  });

  describe('concurrency 1, maxUnread 1', () => {
    const concurrency = 1;
    const maxUnread = 1;

    it('catches exception from mapper - 1st item - stopOnMapperError true', async () => {
      const input = [1, async () => sleep(300, 2), 3];
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          value = typeof value === 'function' ? await value() : value;
          mappedValues.push(value);
          if (value === 1) {
            await sleep(100);
            throw new Error('throw on 1st');
          }
          return value;
        },
        { concurrency, maxUnread },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on 1st');
      await sleep(500);
      expect(loopCount).toBe(0);
      expect(mappedValues).toEqual([1]);
      expect(iteratedValues).toEqual([]);
    });

    it('catches exception from mapper - 2nd item - stopOnMapperError true', async () => {
      const input = [1, async () => sleep(300, 2), 3];
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          value = typeof value === 'function' ? await value() : value;
          mappedValues.push(value);
          if (value === 2) {
            throw new Error('throw on 2nd');
          }
          await sleep(100);

          return value;
        },
        { concurrency, maxUnread },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on 2nd');
      await sleep(300);
      expect(loopCount).toBe(1);
      expect(mappedValues).toEqual([1, 2]);
      expect(iteratedValues).toEqual([1]);
    });

    it('catches exception from mapper - 1st item - stopOnMapperError false', async () => {
      const input = [1, async () => sleep(300, 2), 3];
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          value = typeof value === 'function' ? await value() : value;
          mappedValues.push(value);
          if (value === 1) {
            throw new Error('throw on 1st');
          }
          await sleep(100);

          return value;
        },
        { concurrency: 1, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on 1st');
      await sleep(300);
      expect(loopCount).toBe(2);
      expect(mappedValues).toEqual([1, 2, 3]);
      expect(iteratedValues).toEqual([2, 3]);
    });

    it('catches exception from mapper - 2nd item - stopOnMapperError false', async () => {
      const input = [1, async () => sleep(300, 2), 3];
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          value = typeof value === 'function' ? await value() : value;
          mappedValues.push(value);
          if (value === 2) {
            throw new Error('throw on 2nd');
          }
          await sleep(100);

          return value;
        },
        { concurrency, maxUnread, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on 2nd');
      await sleep(300);
      expect(loopCount).toBe(2);
      expect(mappedValues).toEqual([1, 2, 3]);
      expect(iteratedValues).toEqual([1, 3]);
    });

    it('catches exception from mapper - 10 of 10 items - stopOnMapperError false', async () => {
      const input = new SleepIterator(10);
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        (value): number => {
          mappedValues.push(value);
          throw new Error('throw on each');
        },
        { concurrency, maxUnread, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on each');
      expect(loopCount).toBe(0);
      expect(mappedValues).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(iteratedValues).toEqual([]);
    });

    it('catches exception from mapper - 10 of 10 items - stopOnMapperError true', async () => {
      const input = new SleepIterator(10);
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        (value): number => {
          mappedValues.push(value);
          throw new Error('throw on each');
        },
        { concurrency, maxUnread, stopOnMapperError: true },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on each');
      expect(loopCount).toBe(0);
      expect(mappedValues).toEqual([1]);
      expect(iteratedValues).toEqual([]);
    });

    it('catches exception from source iterator - 1st item', async () => {
      const input = new ThrowingIterator(100, 0, 100);
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          mappedValues.push(value);
          await sleep(100);
          return value;
        },
        { concurrency, maxUnread, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throwing on index 0');
      await sleep(500);
      expect(loopCount).toBe(0);
      expect(mappedValues).toEqual([]);
      expect(iteratedValues).toEqual([]);
    });

    // The 2nd iterable item throwing is distinct from the 1st when concurrency is 1 because
    // it means that the sourceNext() is invoked from next() or sourceNext() and not from
    // the constructor
    it('catches exception from source iterator - 2nd item', async () => {
      const input = new ThrowingIterator(100, 1, 100);
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          mappedValues.push(value);
          await sleep(100);
          return value;
        },
        { concurrency, maxUnread, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throwing on index 1');
      await sleep(500);
      expect(loopCount).toBe(1);
      expect(mappedValues).toEqual([0]);
      expect(iteratedValues).toEqual([0]);
    });
  });

  describe('concurrency 2, maxUnread 4', () => {
    const concurrency = 2;
    const maxUnread = 4;

    it('catches exception from mapper - 1st item - stopOnMapperError true', async () => {
      const input = [1, async () => sleep(300, 2), 3];
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          value = typeof value === 'function' ? await value() : value;
          mappedValues.push(value);
          if (value === 1) {
            await sleep(100);
            throw new Error('throw on 1st');
          }
          return value;
        },
        { concurrency, maxUnread },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on 1st');
      await sleep(500);
      expect(loopCount).toBe(0);
      expect(mappedValues).toEqual([1, 2]);
      expect(iteratedValues).toEqual([]);
    });

    it('catches exception from mapper - 2nd item - stopOnMapperError true', async () => {
      const input = [1, async () => sleep(300, 2), 3];
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          value = typeof value === 'function' ? await value() : value;
          mappedValues.push(value);
          if (value === 2) {
            throw new Error('throw on 2nd');
          }
          await sleep(100);

          return value;
        },
        { concurrency, maxUnread },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on 2nd');
      await sleep(300);
      expect(loopCount).toBe(2);
      expect(mappedValues).toEqual([1, 3, 2]);
      expect(iteratedValues).toEqual([1, 3]);
    });

    it('catches exception from mapper - 1st item - stopOnMapperError false', async () => {
      const input = [1, async () => sleep(300, 2), 3];
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          value = typeof value === 'function' ? await value() : value;
          mappedValues.push(value);
          if (value === 1) {
            throw new Error('throw on 1st');
          }
          await sleep(100);

          return value;
        },
        { concurrency, maxUnread, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on 1st');
      await sleep(300);
      expect(loopCount).toBe(2);
      expect(mappedValues).toEqual([1, 3, 2]);
      expect(iteratedValues).toEqual([3, 2]);
    });

    it('catches exception from mapper - 2nd item - stopOnMapperError false', async () => {
      const input = [1, async () => sleep(300, 2), 3];
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          value = typeof value === 'function' ? await value() : value;
          mappedValues.push(value);
          if (value === 2) {
            throw new Error('throw on 2nd');
          }
          await sleep(100);

          return value;
        },
        { concurrency, maxUnread, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on 2nd');
      await sleep(300);
      expect(loopCount).toBe(2);
      expect(mappedValues).toEqual([1, 3, 2]);
      expect(iteratedValues).toEqual([1, 3]);
    });

    it('catches exception from mapper - 10 of 10 items - stopOnMapperError false', async () => {
      const input = new SleepIterator(10);
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        (value): number => {
          mappedValues.push(value);
          throw new Error('throw on each');
        },
        { concurrency, maxUnread, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on each');
      expect(loopCount).toBe(0);
      expect(mappedValues).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(iteratedValues).toEqual([]);
    });

    it('catches exception from mapper - 10 of 10 items - stopOnMapperError true', async () => {
      const input = new SleepIterator(10);
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        (value): number => {
          mappedValues.push(value);
          throw new Error('throw on each');
        },
        { concurrency, maxUnread, stopOnMapperError: true },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on each');
      expect(loopCount).toBe(0);
      expect(mappedValues).toEqual([1]);
      expect(iteratedValues).toEqual([]);
    });

    it('catches exception from source iterator - 1st item', async () => {
      const input = new ThrowingIterator(100, 0, 100);
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          mappedValues.push(value);
          await sleep(100);
          return value;
        },
        { concurrency, maxUnread, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throwing on index 0');
      await sleep(500);
      expect(loopCount).toBe(0);
      expect(mappedValues).toEqual([]);
      expect(iteratedValues).toEqual([]);
    });

    // The 2nd iterable item throwing is distinct from the 1st when concurrency is 1 because
    // it means that the sourceNext() is invoked from next() or sourceNext() and not from
    // the constructor
    it('catches exception from source iterator - 2nd item', async () => {
      const input = new ThrowingIterator(100, 1, 100);
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          mappedValues.push(value);
          await sleep(100);
          return value;
        },
        { concurrency, maxUnread, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throwing on index 1');
      await sleep(500);
      expect(loopCount).toBe(1);
      expect(mappedValues).toEqual([0]);
      expect(iteratedValues).toEqual([0]);
    });
  });

  describe('concurrency Number.POSITIVE_INFINITY, maxUnread Number.POSITIVE_INFINITY', () => {
    const concurrency = Number.POSITIVE_INFINITY;
    const maxUnread = Number.POSITIVE_INFINITY;

    it('catches exception from mapper - 1st item - stopOnMapperError true', async () => {
      const input = [1, async () => sleep(300, 2), 3];
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          value = typeof value === 'function' ? await value() : value;
          mappedValues.push(value);
          if (value === 1) {
            await sleep(100);
            throw new Error('throw on 1st');
          }
          return value;
        },
        { concurrency, maxUnread },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on 1st');
      await sleep(500);
      expect(loopCount).toBe(1);
      expect(mappedValues).toEqual([1, 3, 2]);
      // NOTE: This seems wrong - Item 2 succeeds at being mapped, but after the 1st item throws.
      // Since item 2 was mapped you would think it should be iterated with the exception for
      // item 1 delayed until all items are read.
      // However, since the mapper for 2 could throw, this could lead to 2 exceptions wanting to
      // throw if we waited like this... so we would have to throw an AggregateError... and
      // that just leads to guidance that the caller should catch exceptions in their mapper
      // and return them as part of their NewElement object type.
      // If a consumer catches and returns the exception then re-throws in their `for await`
      // then this behavior would match their results exactly (the 1st item would cause the iteration
      // loop to break out).
      expect(iteratedValues).toEqual([3]);
    });

    it('catches exception from mapper - 2nd item - stopOnMapperError true', async () => {
      const input = [1, async () => sleep(300, 2), 3];
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        async (value): Promise<number> => {
          value = typeof value === 'function' ? await value() : value;
          mappedValues.push(value);
          if (value === 2) {
            throw new Error('throw on 2nd');
          }
          await sleep(100);

          return value;
        },
        { concurrency, maxUnread },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on 2nd');
      await sleep(300);
      expect(loopCount).toBe(2);
      expect(mappedValues).toEqual([1, 3, 2]);
      expect(iteratedValues).toEqual([1, 3]);
    });

    it('async mapper works', async () => {
      const max = 100;
      const iterator = new SleepIterator(max);
      let total = 0;
      let callCount = 0;
      const prefetcher = new IterableMapper(
        iterator,
        async (value: number): Promise<number> => {
          callCount++;
          total += value;
          await sleep(10 * (callCount % 6));
          return total;
        },
        { concurrency, maxUnread },
      );

      let lastTotal = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastTotal) {
          lastTotal = item;
        }
      }

      expect(callCount).toBe(max);
      expect(loopCount).toBe(max);
      expect(total).toBe((max * (max + 1)) / 2);
      expect(lastTotal).toBe((max * (max + 1)) / 2);
    });

    it('catches exception from mapper - 10 of 10 items - stopOnMapperError true', async () => {
      const input = new SleepIterator(10);
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        (value): number => {
          mappedValues.push(value);
          throw new Error('throw on each');
        },
        { concurrency, maxUnread, stopOnMapperError: true },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on each');
      expect(loopCount).toBe(0);
      expect(mappedValues).toEqual([1]);
      expect(iteratedValues).toEqual([]);
    });

    it('catches exception from mapper - 10 of 10 items - stopOnMapperError false', async () => {
      const input = new SleepIterator(10);
      const mappedValues: number[] = [];
      const iteratedValues: number[] = [];
      const prefetcher = new IterableMapper(
        input,
        (value): number => {
          mappedValues.push(value);
          throw new Error('throw on each');
        },
        { concurrency, maxUnread, stopOnMapperError: false },
      );
      let loopCount = 0;
      await expect(async () => {
        for await (const value of prefetcher) {
          loopCount++;
          iteratedValues.push(value);
        }
      }).rejects.toThrowError('throw on each');
      expect(loopCount).toBe(0);
      expect(mappedValues).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(iteratedValues).toEqual([]);
    });
  });
});

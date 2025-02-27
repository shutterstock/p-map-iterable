/**
 * Example demonstrating the queue depth control feature with SimpleBackgroundFlusher
 */
import { SimpleBackgroundFlusher } from '../src';

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Example showing how to use SimpleBackgroundFlusher with different queue configurations
 */
async function main() {
  // First example - default behavior (maxQueueDepth = concurrency)
  await defaultBehaviorExample();

  // Second example - FIFO sequential processing with separate queue depth
  await sequentialFifoExample();
}

/**
 * Default behavior (maxQueueDepth equals concurrency)
 */
async function defaultBehaviorExample() {
  console.log('\n--- Default Behavior Example (maxQueueDepth = concurrency) ---');

  // Simulate a destination write operation
  const writeDestination = async (item: { id: number }) => {
    console.log(`Processing item ${item.id}...`);
    await delay(300); // Simulate I/O operation
  };

  // Create a simple background flusher with concurrency 2
  // By default, maxQueueDepth = concurrency (2)
  const flusher = new SimpleBackgroundFlusher(writeDestination, {
    concurrency: 2, // Process 2 items at a time, queue limited to 2 items
  });

  console.log('Adding items - only 2 can be queued before blocking (default behavior)');

  const startTime = Date.now();
  for (let i = 1; i <= 6; i++) {
    const item = { id: i };
    const enqueueStart = Date.now();
    console.log(`Trying to enqueue item ${i} at ${enqueueStart - startTime}ms`);

    await flusher.enqueue(item);

    const enqueueEnd = Date.now();
    console.log(`Item ${i} enqueued after ${enqueueEnd - enqueueStart}ms`);

    // No delay between enqueues to demonstrate blocking behavior
  }

  console.log('Waiting for all processing to complete...');
  await flusher.onIdle();
  console.log('All items processed successfully');
}

/**
 * Example showing how to use SimpleBackgroundFlusher with FIFO sequential processing
 * and a separate queue depth control
 */
async function sequentialFifoExample() {
  console.log('\n--- Sequential FIFO Processing Example ---');

  // Simulate a database write operation that must be in order
  const writeToDatabase = async (item: { id: number }) => {
    console.log(`DB Writing item ${item.id}...`);
    await delay(300); // Simulate DB write operation
  };

  // Create a simple background flusher with:
  // - concurrency: 1 (process one item at a time)
  // - maxQueueDepth: 5 (allow up to 5 items to be queued before blocking)
  const dbFlusher = new SimpleBackgroundFlusher(writeToDatabase, {
    concurrency: 1, // Process 1 write at a time (sequential FIFO processing)
    maxQueueDepth: 5, // Allow up to 5 items to be queued before blocking
  });

  console.log('Adding items rapidly - they will queue up to maxQueueDepth limit (5)');

  // This will queue up items quickly, but they will be processed one at a time
  const startTime = Date.now();
  for (let i = 1; i <= 8; i++) {
    const enqueueStart = Date.now();
    console.log(`Trying to enqueue DB item ${i} at ${enqueueStart - startTime}ms`);

    await dbFlusher.enqueue({ id: i });

    const enqueueEnd = Date.now();
    const elapsed = enqueueEnd - enqueueStart;

    console.log(`Item ${i} enqueued after ${elapsed}ms`);

    // Items 1-5 should enqueue immediately, item 6 will block until item 1 is processed
  }

  // Wait for all background operations to complete
  console.log('Waiting for all DB writes to complete...');
  await dbFlusher.onIdle();
  console.log('All DB writes completed');
  console.log('Sequential FIFO Processing complete');
}

// Run the examples
main().catch(console.error);

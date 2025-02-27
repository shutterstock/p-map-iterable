/**
 * Example demonstrating the semantic alias types
 */
import { Prefetcher, BackgroundFlusher, SimpleBackgroundFlusher } from '../src';

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Example showing how to use the Prefetcher (IterableMapper)
 */
async function prefetcherExample() {
  console.log('\n--- Prefetcher Example ---');

  // Source data - in real apps this could be database IDs, file paths, etc.
  const sourceIds = [1, 2, 3, 4, 5];

  // Simulate a slow source read operation (like a database or file read)
  const readSource = async (id: number) => {
    console.log(`Reading source ${id}...`);
    await delay(300); // Simulate I/O operation
    return { id, data: `Data for ${id}` };
  };

  // Create a prefetcher that will fetch items ahead of time
  const prefetcher = new Prefetcher(sourceIds, readSource, {
    concurrency: 2, // Process 2 reads at a time
    maxUnread: 3, // Don't get more than 3 items ahead of consumer
  });

  // Process items as they become available
  for await (const item of prefetcher) {
    console.log(`Processing item: ${item.id}`);
    await delay(200); // Simulate processing time
  }

  console.log('Prefetcher complete');
}

/**
 * Example showing how to use the BackgroundFlusher (IterableQueueMapper)
 */
async function backgroundFlusherExample() {
  console.log('\n--- BackgroundFlusher Example ---');

  // Simulate a slow destination write operation
  const writeDestination = async (item: { id: number; processed: boolean }) => {
    console.log(`Flushing item ${item.id} to destination...`);
    await delay(400); // Simulate I/O operation
    return { id: item.id, status: 'written' };
  };

  // Create a background flusher that will handle writes in the background
  const flusher = new BackgroundFlusher(writeDestination, {
    concurrency: 2, // Process 2 writes at a time
  });

  // Simulate generating some data that needs to be flushed
  for (let i = 1; i <= 5; i++) {
    const item = { id: i, processed: true };
    console.log(`Enqueueing item ${i} for flushing`);
    await flusher.enqueue(item);
    await delay(100); // Simulate time to prepare next item
  }

  // Mark the queue as done - no more items will be added
  flusher.done();

  // Iterate through the results if needed
  console.log('Checking flush results:');
  for await (const result of flusher) {
    console.log(`Item ${result.id} flush status: ${result.status}`);
  }

  console.log('BackgroundFlusher complete');
}

/**
 * Example showing how to use the SimpleBackgroundFlusher (IterableQueueMapperSimple)
 */
async function simpleBackgroundFlusherExample() {
  console.log('\n--- SimpleBackgroundFlusher Example ---');

  // Simulate a slow destination write operation where the result isn't needed
  const writeDestination = async (item: { id: number; processed: boolean }) => {
    console.log(`Writing item ${item.id} to destination...`);
    await delay(300); // Simulate I/O operation
    // No return value needed - operation is fire and forget
  };

  // Create a simple background flusher
  const flusher = new SimpleBackgroundFlusher(writeDestination, {
    concurrency: 2, // Process 2 writes at a time
  });

  // Simulate generating some data that needs to be written
  for (let i = 1; i <= 5; i++) {
    const item = { id: i, processed: true };
    console.log(`Enqueueing item ${i} for writing`);
    await flusher.enqueue(item);
    await delay(100); // Simulate time to prepare next item
  }

  // Wait for all background operations to complete
  console.log('Waiting for all writes to complete...');
  await flusher.onIdle();

  // Check if there were any errors
  if (flusher.errors.length > 0) {
    console.error('Errors occurred during background processing:', flusher.errors);
  } else {
    console.log('All writes completed successfully');
  }

  console.log('SimpleBackgroundFlusher complete');
}

// Run all examples
async function main() {
  await prefetcherExample();
  await backgroundFlusherExample();
  await simpleBackgroundFlusherExample();
}

main().catch(console.error);

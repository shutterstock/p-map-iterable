import { IterableQueueMapperSimple } from '@shutterstock/p-map-iterable';

type Batch = { sequence: number; records: string[] };

async function main(): Promise<void> {
  const written: number[] = [];
  const writer = new IterableQueueMapperSimple<Batch>(
    async (batch) => {
      // Stand in for a destination that requires ordered batch writes.
      // Resolve only after the write has completed.
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      written.push(batch.sequence);
      console.log(`Completed batch ${batch.sequence}`);
    },
    { concurrency: 1, maxQueueDepth: 3 },
  );

  try {
    for (let sequence = 1; sequence <= 6; sequence++) {
      const batch = { sequence, records: [`prepared record ${sequence}`] };
      await writer.enqueue(batch);
      console.log(`Admitted batch ${sequence}`);
    }
  } finally {
    // Terminal close, including any accepted writes still running or waiting.
    await writer.onIdle();
  }

  if (writer.errors.length > 0) {
    throw new Error(`${writer.errors.length} batch writes failed`);
  }
  console.log(`Write order: ${written.join(', ')}`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

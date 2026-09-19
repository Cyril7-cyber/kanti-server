// A minimal stand-in for the supabase-js query builder. Every chain method
// (select/insert/update/delete/eq/gt/order/limit) just returns the same
// chain object, and the chain resolves — whether awaited directly or via
// `.single()` — to whatever result was queued for that table. Tests queue
// results per table, in the exact order the route under test calls
// `.from(table)`, mirroring how the real handler reads/writes.
function createChain(result) {
  const chain = {};
  const passthroughMethods = [
    "select",
    "insert",
    "update",
    "delete",
    "eq",
    "gt",
    "order",
    "limit",
  ];

  passthroughMethods.forEach((method) => {
    chain[method] = jest.fn(() => chain);
  });

  chain.single = jest.fn(() => Promise.resolve(result));
  chain.then = (onFulfilled, onRejected) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  chain.catch = (onRejected) => Promise.resolve(result).catch(onRejected);

  return chain;
}

function createMockSupabase() {
  const queues = {};

  const from = jest.fn((table) => {
    const queue = queues[table];
    if (!queue || queue.length === 0) {
      throw new Error(
        `mockSupabase: no queued result for supabase.from("${table}"). ` +
          `Call mockSupabase.mockResult("${table}", { data, error }) before the call that needs it.`,
      );
    }
    return createChain(queue.shift());
  });

  return {
    from,
    mockResult(table, result) {
      if (!queues[table]) queues[table] = [];
      queues[table].push(result);
      return this;
    },
    __reset() {
      Object.keys(queues).forEach((key) => delete queues[key]);
      from.mockClear();
    },
  };
}

module.exports = { createMockSupabase };

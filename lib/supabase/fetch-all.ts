// Supabase (PostgREST) returns at most 1,000 rows per request. These helpers fetch every row.
type Result<T> = { data: T[] | null; error: { message: string } | null };

// Page through a query. The query must have a stable order (for example .order("id")).
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<Result<T>>,
  size = 1000,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) return { data: all, error };
    all.push(...(data ?? []));
    if (!data || data.length < size) return { data: all, error: null };
  }
}

// For .in("column", ids) with many ids: split the ids into chunks (keeps the URL short) and page each chunk.
export async function fetchAllByIds<T, K>(
  ids: K[],
  page: (chunk: K[], from: number, to: number) => PromiseLike<Result<T>>,
  chunkSize = 300,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await fetchAllRows<T>((from, to) => page(chunk, from, to));
    if (error) return { data: all, error };
    all.push(...data);
  }
  return { data: all, error: null };
}

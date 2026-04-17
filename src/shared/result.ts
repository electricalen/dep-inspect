/**
 * Re-exports from neverthrow for convenient access throughout the codebase.
 * All fallible operations return Result<T, E> or ResultAsync<T, E>.
 */
export { ok, err, Result, ResultAsync, fromPromise, fromThrowable } from 'neverthrow'

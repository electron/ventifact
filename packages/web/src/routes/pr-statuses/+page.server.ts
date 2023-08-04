import { Temporal } from '@js-temporal/polyfill';
import { type PR, countPRStatusesByDateAsc } from 'data-lib';
import type { PageServerLoad } from './$types';

export interface DehydratedResult {
	data: {
		date: string;
		counts: [PR['status'], number][];
	}[];
}

const CACHE_DURATION: Temporal.DurationLike = { hours: 12 };

// We cache the result in memory
let cache:
	| { result: DehydratedResult; expires: Temporal.Instant }
	| Promise<DehydratedResult>
	| undefined;

export const load = ((): Promise<DehydratedResult> => {
	// Try to use the cached result
	if (cache !== undefined) {
		// If the cache is a promise, then it's still computing
		if (cache instanceof Promise) {
			return cache;
		}

		// We have a cached result, but we need to check if it's expired
		if (Temporal.Instant.compare(Temporal.Now.instant(), cache.expires) < 0) {
			// The cache is not expired, so return the cached result
			return Promise.resolve(cache.result);
		}

		// The cache is expired, so we need to recompute
		cache = undefined;
	}

	// Compute the data, marking the cache as a promise that it's still computing
	cache = countPRStatusesByDateAsc().then((buckets) => ({
		data: buckets.map((bucket) => ({
			date: bucket.date.toString(),
			counts: [...bucket.counts.entries()]
		}))
	}));

	// Cache the result once its done and forward the result
	return cache.then((result) => {
		// Cache the result
		cache = {
			result,
			expires: Temporal.Now.instant().add(CACHE_DURATION)
		};

		return result;
	});
}) satisfies PageServerLoad;

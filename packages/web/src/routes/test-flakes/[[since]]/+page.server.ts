import { Temporal } from '@js-temporal/polyfill';
import type { PageServerLoad } from './$types';
import { fetchSomeTestFlakesSince } from 'data-lib';

const BATCH_SIZE = 50;

function tryParseInstant(value: unknown): Temporal.Instant | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	try {
		return Temporal.Instant.from(value);
	} catch {
		return undefined;
	}
}

export const load = (async ({ params }) => {
	const since = tryParseInstant(params.since);
	const flakes = await fetchSomeTestFlakesSince(BATCH_SIZE, since);

	return {
		flakes: flakes.map((flake) => ({
			...flake,
			timestamp: flake.timestamp.toString()
		})),
		hasMore: flakes.length === BATCH_SIZE
	};
}) satisfies PageServerLoad;

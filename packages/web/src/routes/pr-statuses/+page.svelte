<script lang="ts">
	import { Temporal } from '@js-temporal/polyfill';
	import type { PageData } from './$types';
	import Chart from './Chart.svelte';
	import type { PR } from 'data-lib';
	import { OrderedMap, Map } from 'immutable';

	export let data: PageData;
	$: rehydratedData = OrderedMap(data.dehydrated.map(({ date, counts }) => [date, Map(counts)]));

	let rollingAverageDuration: number | undefined = 14;
	let showStatus = Map<PR['status'], boolean>({
		success: true,
		failure: true,
		neutral: true,
		unknown: false
	});

	const PASSING_GOAL = 0.8;

	$: [date, passingPct, failingPct] = calculateLatestPassingAndFailingPercentages(rehydratedData);
	$: meetingGoal = passingPct !== undefined && passingPct >= PASSING_GOAL;

	function calculateLatestPassingAndFailingPercentages(
		data: OrderedMap<string, Map<PR['status'], number>>
	): [string, number | undefined, number | undefined] {
		const lastEntry = data.entrySeq().last();

		// If there is no data, return undefined
		if (lastEntry === undefined) {
			return ['', undefined, undefined];
		}

		const [date, counts] = lastEntry;

		const dateStr = Temporal.PlainDate.from(date).toLocaleString();

		const passing = counts.get('success', 0);
		const failing = counts.get('failure', 0);

		// Protect against a division by zero
		if (passing === 0 && failing === 0) {
			return [dateStr, 0, 0];
		} else {
			const total = passing + failing;
			return [dateStr, passing / total, failing / total];
		}
	}

	function formatPct(pct: number): string {
		return `${(pct * 100).toFixed(1)}%`;
	}
</script>

<div class="flex flex-col gap-4">
	<div>
		<h1 class="font-bold text-lg">Pull Request Statuses</h1>
		<p class="text-sm">View and analyze the health of pull requests.</p>
	</div>

	<div class="flex flex-col gap-2">
		{#if passingPct !== undefined && failingPct !== undefined}
			<div class="flex flex-col gap-1">
				<div>
					<span class="font-bold text-md">Latest</span> ({date})
				</div>
				<div class="flex flex-row flex-wrap gap-4">
					{#if passingPct !== undefined}
						<div
							class={`p-4 border-2 rounded-lg border-green-500 ${
								meetingGoal ? 'bg-green-500 text-white' : ''
							}`}
						>
							<div class="font-bold text-md">Passing</div>
							<div class="font-light text-4xl">{formatPct(passingPct)}</div>
						</div>
					{/if}
					{#if failingPct !== undefined}
						<div
							class={`p-4 border-2 rounded-lg border-red-500 ${
								meetingGoal ? '' : 'bg-red-500 text-white'
							}`}
						>
							<div class="font-bold text-md">Failing</div>
							<div class="font-light text-4xl">{formatPct(failingPct)}</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<div>
			<!-- TODO: controls -->
		</div>

		<Chart
			rawData={rehydratedData}
			{rollingAverageDuration}
			shownStatuses={showStatus
				.toSeq()
				.filter((show) => show)
				.keySeq()
				.toSet()}
		/>
	</div>
</div>

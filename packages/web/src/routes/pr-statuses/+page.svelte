<script lang="ts">
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

	$: [passingPct, failingPct] = calculatePassingAndFailingPercentages(rehydratedData);
	$: meetingGoal = passingPct !== undefined && passingPct >= PASSING_GOAL;

	function calculatePassingAndFailingPercentages(
		data: OrderedMap<string, Map<PR['status'], number>>
	): [number | undefined, number | undefined] {
		const counts = data.last();

		// If there is no data, return undefined
		if (counts === undefined) {
			return [undefined, undefined];
		}

		const passing = counts.get('success', 0);
		const failing = counts.get('failure', 0);

		// Protect against a division by zero
		if (passing === 0 && failing === 0) {
			return [0, 0];
		} else {
			const total = passing + failing;
			return [passing / total, failing / total];
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

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
</script>

<div class="flex flex-col gap-4">
	<div>
		<h1 class="font-bold text-lg">Pull Request Statuses</h1>
		<p class="text-sm">View and analyze the health of pull requests.</p>
	</div>

	<div class="flex flex-col flex-wrap gap-2">
		<div>
			<!-- TODO: big stats -->
		</div>

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

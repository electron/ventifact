<script lang="ts">
	import { Temporal } from '@js-temporal/polyfill';
	import type { PageData } from './$types';
	import Chart from './Chart.svelte';

	export let data: PageData;
</script>

<div class="flex flex-col gap-4">
	<div>
		<h1 class="font-bold text-lg">Pull Request Statuses</h1>
		<p class="text-sm">View and analyze the health of pull requests.</p>
	</div>

	<Chart
		data={data.data.map((bucket) => ({
			date: Temporal.PlainDate.from(bucket.date),
			counts: new Map(bucket.counts)
		}))}
	/>
</div>

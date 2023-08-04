<script lang="ts">
	import { Temporal } from '@js-temporal/polyfill';
	import type { PageData } from './$types';
	import ArrowSquareOut from 'phosphor-svelte/lib/ArrowSquareOut/ArrowSquareOut.svelte';

	export let data: PageData;

	function flakeSourceURL(testRunID: PageData['flakes'][number]['test_run_id']): URL | undefined {
		switch (testRunID.source) {
			case 'appveyor':
				// TODO: figure this one out
				return undefined;
			case 'circleci':
				return new URL(
					`https://app.circleci.com/pipelines/github/electron/electron/-/workflows/-/jobs/${testRunID.jobId}`
				);
			default:
				return undefined;
		}
	}

	$: flakes = data.flakes.map((flake) => {
		return {
			title: flake.test_title,
			timestamp: Temporal.Instant.from(flake.timestamp),
			url: flakeSourceURL(flake.test_run_id)
		};
	});
</script>

<div class="flex flex-col gap-4">
	<div>
		<h1 class="font-bold text-lg">Test Flakes</h1>
		<p class="text-sm">View recent test flakes.</p>
	</div>

	{#if flakes.length === 0}
		<p>None.</p>
	{/if}

	<ul class="flex flex-col gap-2">
		{#each flakes as flake}
			<li class="flex flex-row gap-2 p-2 bg-red-100 text-red-950 rounded-md">
				<div class="flex flex-col flex-1 basis-auto">
					<p>
						{flake.title}
					</p>
					<p>
						{flake.timestamp.toLocaleString()}
					</p>
				</div>
				{#if flake.url !== undefined}
					<a href={flake.url.toString()} class="flex-initial flex-shrink-0">
						<ArrowSquareOut size="1.5em" />
					</a>
				{/if}
			</li>
		{/each}
	</ul>

	{#if data.hasMore}
		<a href={'test-flakes/' + flakes[flakes.length - 1].timestamp.toString()}>See more...</a>
	{/if}
</div>

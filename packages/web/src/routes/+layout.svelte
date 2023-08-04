<script>
	import '../app.css';
	import Wind from 'phosphor-svelte/lib/Wind/Wind.svelte';
</script>

<svelte:head>
	<title>Ventifact</title>
</svelte:head>

<div class="flex flex-col md:flex-row md:justify-center xl:mt-12">
	<nav class="flex flex-col items-center p-2 gap-2 select-none md:w-48 md:p-4 md:items-start">
		<h1 class="font-bold">
			<a href="/" class="flex flex-row gap-1 items-center">
				<Wind size="1.5em" />
				Ventifact
			</a>
		</h1>
		<ul class="flex flex-row flex-wrap justify-center md:flex-col gap-2">
			{#each [{ href: '/pr-statuses', title: 'PR Statuses' }, { href: '/test-runs', title: 'Test Runs' }] as { href, title }}
				<li>
					<a {href} class="px-2 py-1 rounded hover:bg-stone-200 focus:bg-stone-200">{title}</a>
				</li>
			{/each}
		</ul>
	</nav>

	<main class="flex-1 p-4 md:max-w-2xl">
		<slot />
	</main>
</div>

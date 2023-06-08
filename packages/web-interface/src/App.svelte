<script lang="ts">
  import MergedPRsChart, { type MergedPRsData } from "./MergedPRsChart.svelte";

  let dataPromise: Promise<MergedPRsData> = fetchData();

  function fetchData(): Promise<MergedPRsData> {
    if (import.meta.env.DEV) {
      // In development, we can't use the API because it's not running on the
      // dev server. Instead, we'll just generate some fake data.
      const data = new Array(142);
      for (let i = 0; i < data.length; i++) {
        const date = new Date(2023, 0, i + 1);

        data[i] = {
          date: date.toISOString().slice(0, 10),
          counts: {
            success: Math.floor(Math.random() * 10),
            failure: Math.floor(Math.random() * 10),
            neutral: Math.floor(Math.random() * 10),
            unknown: Math.floor(Math.random() * 10),
          },
        };
      }

      return Promise.resolve(data);
    }

    return fetch("/api/merged-pr-statuses").then((res) => res.json());
  }
</script>

<main>
  <div class="chart">
    {#await dataPromise}
      <span class="loading">Loading...</span>
    {:then data}
      <MergedPRsChart {data} />
    {:catch error}
      <pre class="error">{error.toString()}</pre>
    {/await}
  </div>
</main>

<style>
  :global(html),
  :global(body),
  main {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
  }

  .chart {
    display: flex;
    justify-content: center;
    align-items: center;

    width: 100%;
    height: 100%;
  }

  .chart > pre {
    max-width: 100ch;
  }
</style>

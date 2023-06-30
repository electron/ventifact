<script lang="ts" context="module">
  export interface DateBucket {
    date: string;
    counts: Record<"success" | "failure" | "neutral" | "unknown", number>;
  }

  export type MergedPRsData = DateBucket[];
</script>

<script lang="ts">
  import { Temporal } from "@js-temporal/polyfill";
  import { onDestroy } from "svelte";

  import {
    Chart,
    Filler,
    LineController,
    LineElement,
    LinearScale,
    PointElement,
    TimeScale,
  } from "chart.js";
  import "chartjs-adapter-date-fns";
  Chart.register(
    Filler,
    LineController,
    LineElement,
    LinearScale,
    PointElement,
    TimeScale,
  );

  export let data: MergedPRsData;

  let canvasElem: HTMLCanvasElement;
  let chart: Chart;

  /**
   * Destroys and unsets the chart if it exists.
   */
  function tryClearChart() {
    if (chart !== undefined) {
      chart.destroy();
      chart = undefined;
    }
  }

  function rollingDateAverage(
    dateRange: Temporal.Duration,
    datedData: Map<string, DateBucket["counts"]>,
  ): Map<string, DateBucket["counts"]> {
    const result = new Map<string, DateBucket["counts"]>();

    for (const [targetDateStr, targetDateCounts] of datedData.entries()) {
      // Initialize the counts to those of the target date
      const rangeCountSums = Object.assign({}, targetDateCounts);
      let totalCount = 1; // 1 since we already have the target date counts

      // Iterate over every date *before* the target date (so we don't count it
      // twice)
      const targetDate = Temporal.PlainDate.from(targetDateStr);
      for (
        let date = targetDate.subtract(dateRange);
        Temporal.PlainDate.compare(date, targetDate) < 0;
        date = date.add({ days: 1 })
      ) {
        // Try to get this date's counts, skipping it if there is no data
        const counts = datedData.get(date.toString());
        if (counts === undefined) {
          continue;
        }

        // Add this date's counts to the sums
        for (const [key, count] of Object.entries(counts)) {
          rangeCountSums[key] += count;
        }
        totalCount += 1;
      }

      // Calculate and add the average to the result data
      for (const key of Object.keys(rangeCountSums)) {
        rangeCountSums[key] /= totalCount;
      }
      result.set(targetDateStr, rangeCountSums);
    }

    return result;
  }

  // Attach the chart to the canvas element when it is mounted
  $: if (canvasElem !== undefined) {
    // If there's already a chart, destroy it
    tryClearChart();

    // Process the data
    const processedDataMap = rollingDateAverage(
      Temporal.Duration.from({ weeks: 4 }),
      new Map(data.map((bucket) => [bucket.date, bucket.counts])),
    );
    const sortedData = Array.from(processedDataMap.entries())
      .map(([date, counts]) => ({ date, counts }))
      .sort((a, b) => Temporal.PlainDate.compare(a.date, b.date));

    // Extract the data for the chart
    const dateLabels = sortedData.map((bucket) => bucket.date);
    const [successData, failureData] = ["success", "failure"].map(
      (key: keyof DateBucket["counts"]) =>
        sortedData.map((bucket) => bucket.counts[key]),
    );

    // Create the chart
    chart = new Chart(canvasElem, {
      type: "line",
      data: {
        labels: dateLabels,
        datasets: [
          {
            label: "Failed",
            data: failureData,
            borderColor: "#e00",
            backgroundColor: "rgba(224, 0, 0, 0.1)",
            fill: "stack",
          },
          {
            label: "Succeeded",
            data: successData,
            borderColor: "#0b0",
            backgroundColor: "rgba(0, 176, 0, 0.1)",
            fill: "stack",
          },
        ],
      },
      options: {
        scales: {
          x: {
            type: "time",
            time: {
              unit: "day",
              tooltipFormat: "MMM D, YYYY",
            },
          },
          y: {
            beginAtZero: true,
            stacked: true,
          },
        },
        plugins: {
          filler: {
            propagate: true,
          },
        },
      },
    });
  }

  // Destroy the chart when the component is destroyed
  onDestroy(() => {
    tryClearChart();
  });
</script>

<canvas bind:this={canvasElem} />

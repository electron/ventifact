<script lang="ts" context="module">
  export interface DateBucket {
    date: string;
    counts: Record<"success" | "failure" | "neutral" | "unknown", number>;
  }

  export type MergedPRsData = DateBucket[];
</script>

<script lang="ts">
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

  // Attach the chart to the canvas element when it is mounted
  $: if (canvasElem !== undefined) {
    // If there's already a chart, destroy it
    tryClearChart();

    // Process the data for the chart
    const dateLabels = data.map((bucket) => bucket.date);
    const [successData, failureData] = ["success", "failure"].map(
      (key: keyof DateBucket["counts"]) =>
        data.map((bucket) => bucket.counts[key]),
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

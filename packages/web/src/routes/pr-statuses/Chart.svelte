<script lang="ts">
	import { Temporal } from '@js-temporal/polyfill';
	import type { PR } from 'data-lib';
	import { OrderedMap, Map, type Set, List } from 'immutable';

	/**
	 * The status of a merged PR.
	 */
	type PRStatus = PR['status'];

	/**
	 * A canonical order of statuses.
	 */
	const STATUS_ORDER: List<PRStatus> = List(['success', 'failure', 'neutral', 'unknown']);

	/**
	 * A date in ISO 8601 format: YYYY-MM-DD.
	 */
	type DateString = string;

	/**
	 * The number of pull requests merged with a certain status on a certain date.
	 */
	type Count = number;

	/**
	 * Points in the form `(date, count)`, in ascending order by date.
	 */
	type DataSeries = OrderedMap<DateString, Count>;

	/**
	 * A `DataSeries` as an SVG path in a certain SVG viewbox.
	 */
	type ChartPath = string;

	/**
	 * Buckets of `Count`s for each PR status, grouped by date in ascending order.
	 */
	type RawData = OrderedMap<DateString, Map<PRStatus, Count>>;

	/**
	 * The counts of each status for each date in ascending order.
	 */
	export let rawData: RawData;

	/**
	 * Averages the data over the given duration in days
	 */
	export let rollingAverageDuration: number | undefined = undefined;

	/**
	 * Whether to show each status.
	 */
	export let shownStatuses: Set<PRStatus>;

	/**
	 * The size of the SVG viewbox.
	 */
	let svgViewBox: { width: number; height: number } = { width: 640, height: 480 };

	// Process the data over the rolling average duration
	$: averagedData =
		rollingAverageDuration !== undefined
			? rollingAverage(rawData, rollingAverageDuration)
			: rawData;

	// Convert each shown status into a series of points
	$: statusSeries = dataSeriesForStatuses(averagedData, shownStatuses);

	// Stack the data series
	$: stackedSeries = stackSeries(
		statusSeries,
		STATUS_ORDER.filter((status) => shownStatuses.has(status))
	);

	// Process the data into a format that can be used by the chart
	$: chartPaths = convertToChartPaths(stackedSeries, svgViewBox);

	/**
	 * Performs a rolling average over the data.
	 */
	function rollingAverage(data: RawData, days: number): RawData {
		// Edge case: no data
		if (data.size === 0) {
			return data;
		}

		// Convert the duration to a Temporal Duration
		const duration = Temporal.Duration.from({ days });

		// We need to exclude the days within the first interval from the average
		// since we don't have enough data to average over the entire interval
		const newFirstDate = Temporal.PlainDate.from(data.keySeq().first()!).add(duration);

		return data
			.toSeq()
			.skipUntil((_, date) => Temporal.PlainDate.compare(date, newFirstDate) >= 0)
			.map((_, date, seq) => {
				// Find the interval of data from `date - duration` to `date`, inclusive
				const intervalStart = Temporal.PlainDate.from(date).subtract(duration);
				const interval = data
					.toSeq()
					.skipUntil((_, d) => Temporal.PlainDate.compare(d, intervalStart) >= 0)
					.takeWhile((_, d) => Temporal.PlainDate.compare(d, date) <= 0)
					.valueSeq()
					.toList();

				// Average the data in the interval
				return interval
					.reduce((sum, counts) => sum.mergeWith((a, b) => a + b, counts), Map<PRStatus, number>())
					.map((sum) => sum / interval.size);
			})
			.toOrderedMap();
	}

	/**
	 * Creates a data series (points in the form `(date, count)`) for each status.
	 */
	function dataSeriesForStatuses(
		data: RawData,
		statuses: Set<PRStatus>
	): Map<PRStatus, DataSeries> {
		return Map(
			statuses
				.toSeq()
				.map(
					(status) =>
						[
							status,
							data.flatMap((counts, date) =>
								counts.has(status) ? [[date, counts.get(status)!]] : []
							)
						] as [PRStatus, DataSeries]
				)
				.filter(([, series]) => series.size > 0)
		);
	}

	/**
	 * Stacks the data series on top of each other, in the order given.
	 */
	function stackSeries(
		series: Map<PRStatus, DataSeries>,
		order: List<PRStatus>
	): OrderedMap<PRStatus, DataSeries> {
		const newSeries: [PRStatus, DataSeries][] = [];

		for (const status of order.reverse()) {
			const data = series.get(status);

			// If the status is not in the series, skip it
			if (data === undefined) {
				continue;
			}

			// For the first series, there is no previous series to stack on top of,
			// so we just add it to the list as-is
			if (newSeries.length === 0) {
				newSeries.push([status, data]);
				continue;
			}

			// Determine the previous series to stack on top of
			const previousSeries = newSeries[newSeries.length - 1][1];

			// Add the current series to the list, stacking it on top of the previous
			// series
			newSeries.push([status, data.map((count, date) => count + previousSeries.get(date, 0))]);
		}

		return OrderedMap(newSeries);
	}

	/**
	 * Converts the data series into an SVG path within the given viewbox.
	 */
	function convertToChartPaths(
		series: OrderedMap<PRStatus, DataSeries>,
		viewBox: { width: number; height: number }
	): OrderedMap<PRStatus, ChartPath> {
		// Since each data series is ordered by date, we can find the min and max
		// dates by looking at the first and last dates in each series
		const minDate = series
			.valueSeq()
			.map((series) => series.keySeq().first())
			.filter(Boolean)
			.minBy((date) => date!, Temporal.PlainDate.compare);
		const maxDate = series
			.valueSeq()
			.map((series) => series.keySeq().last())
			.filter(Boolean)
			.maxBy((date) => date!, Temporal.PlainDate.compare);

		// Find the max count across all series
		const maxCount = series
			.valueSeq()
			.map((series) => series.max())
			.filter(Boolean)
			.max();

		// Edge case: no min or max
		if (minDate === undefined || maxDate === undefined || maxCount === undefined) {
			console.warn('Missing min date, max date, or max count:', { minDate, maxDate, maxCount });
			return OrderedMap();
		}

		// Figure out the conversion factor for dates and counts to SVG coordinates
		const dayToX = viewBox.width / Temporal.PlainDate.from(minDate).until(maxDate).total('days');
		const countToY = viewBox.height / maxCount;

		// Convert each data series into an SVG path
		return series.map((data) => {
			let path = '';

			for (const [date, count] of data) {
				const x = Temporal.PlainDate.from(minDate).until(date).total('days') * dayToX;
				const y = viewBox.height - count * countToY;

				path += `${path === '' ? 'M' : 'L'} ${x} ${y}`;
			}

			return path;
		});
	}

	function strokeColorForStatus(status: PRStatus): string {
		switch (status) {
			case 'success':
				return 'stroke-green-500';
			case 'failure':
				return 'stroke-red-500';
			case 'neutral':
				return 'stroke-neutral-700';
			case 'unknown':
				return 'stroke-slate-700';
		}
	}
</script>

<svg class="w-full aspect-[4/3]" viewBox={`0 0 ${svgViewBox.width} ${svgViewBox.height}`}>
	{#each chartPaths as [status, path]}
		<path d={path} fill="none" stroke-width="0.167em" class={strokeColorForStatus(status)} />
	{/each}
</svg>

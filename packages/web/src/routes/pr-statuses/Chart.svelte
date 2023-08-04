<script lang="ts">
	import type { Temporal } from '@js-temporal/polyfill';
	import type { PR } from 'data-lib';

	/**
	 * The counts of each status for each date in ascending order.
	 */
	export let data: {
		date: Temporal.PlainDate;
		counts: Map<PR['status'], number>;
	}[];

	/**
	 * The size of the SVG viewbox.
	 */
	let svgViewBox: { width: number; height: number } = { width: 640, height: 480 };

	let processedData = processData();

	function processData(): { status: PR['status']; chartPath: string }[] {
		if (data.length === 0) {
			return [];
		}

		const firstDate = data[0].date;

		// Convert each status into a series of points (day, count)
		const points = new Map<PR['status'], { x: number; y: number }[]>();
		for (const { date, counts } of data) {
			for (const [status, count] of counts) {
				const point = { x: firstDate.until(date).total('days'), y: count };

				if (points.has(status)) {
					points.get(status)!.push(point);
				} else {
					points.set(status, [point]);
				}
			}
		}

		// Stack each series of points
		let previousPoints: { x: number; y: number }[] | undefined;
		for (const status of ['unknown', 'neutral', 'failure', 'success'] as const) {
			const pointsForStatus = points.get(status);
			if (pointsForStatus === undefined) {
				continue;
			}

			if (previousPoints !== undefined) {
				let currentIndex = 0;
				let prevPointsIndex = 0;

				while (currentIndex < pointsForStatus.length && prevPointsIndex < previousPoints.length) {
					while (
						prevPointsIndex < previousPoints.length &&
						previousPoints[prevPointsIndex].x !== pointsForStatus[currentIndex].x
					) {
						prevPointsIndex++;
					}

					if (prevPointsIndex < previousPoints.length) {
						pointsForStatus[currentIndex].y += previousPoints[prevPointsIndex].y;
					} else {
						break;
					}

					currentIndex++;
				}
			}

			previousPoints = pointsForStatus;
		}

		if (previousPoints === undefined) {
			return [];
		}

		// Resize the points to the SVG viewbox coordinate space
		const numDays = firstDate.until(data[data.length - 1].date).total('days');
		const maxCount = previousPoints.reduce((max, { y }) => Math.max(max, y), 0);
		for (const dataPoints of points.values()) {
			for (const point of dataPoints) {
				point.x = (point.x / numDays) * svgViewBox.width;
				point.y = (point.y / maxCount) * svgViewBox.height;
			}
		}

		// Format each path as a SVG path string
		return (['unknown', 'neutral', 'failure', 'success'] as const).map((status) => {
			const pointsForStatus = points.get(status);
			if (pointsForStatus === undefined) {
				return { status, chartPath: '' };
			}

			let chartPath = '';
			for (const { x, y } of pointsForStatus) {
				chartPath += `${chartPath.length === 0 ? 'M' : 'L'} ${x} ${svgViewBox.height - y} `;
			}

			return { status, chartPath };
		});
	}

	function strokeColorForStatus(status: PR['status']): string {
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

<div class="flex flex-col gap-2">
	<div>
		<!-- TODO: controls -->
	</div>

	<p>
		<span class="font-bold">NOTE</span>: This chart is a work in progress.
	</p>

	<svg class="w-full aspect-[4/3]" viewBox={`0 0 ${svgViewBox.width} ${svgViewBox.height}`}>
		{#each processedData as { status, chartPath }}
			<path d={chartPath} fill="none" stroke-width="0.25em" class={strokeColorForStatus(status)} />
		{/each}
	</svg>

	<div>
		<!-- TODO: big stats -->
	</div>
</div>
